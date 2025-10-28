// Vite config that leaves your code alone and only copies the used node_modules packages into web/dist
// Usage:
//   npm run copy:modules
// This scans ./js/**/*.js for imports that contain "/node_modules/..." (e.g., "/ovum/node_modules/lodash-es/get.js")
// and copies the referenced package directory from ./node_modules/<pkg> to ./web/dist/node_modules/<pkg>.
//
// Notes:
// - Scoped packages like @scope/name are supported.
// - We intentionally set build.outDir to a temporary folder so Vite doesn't write bundles; the plugin handles the copying.
// - If your import paths are like "/ovum/node_modules/...", keep in mind we preserve the "node_modules" segment under web/dist,
//   so a server/alias can map "/ovum/node_modules" -> "/ovum/web/dist/node_modules" for distribution.

import { promises as fsp } from 'fs';
import fs from 'fs';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
// For bundling specific problematic CJS-only modules (e.g., braces)
let rollupBundle = null;
let commonjs = null;
let nodeResolve = null;
let alias = null;
try {
  // Lazy-load so this file still works even if rollup plugins are not present for other tasks
  ({ rollup: rollupBundle } = await import('rollup'));
  ({ default: commonjs } = await import('@rollup/plugin-commonjs'));
  ({ default: nodeResolve } = await import('@rollup/plugin-node-resolve'));
  ({ default: alias } = await import('@rollup/plugin-alias'));
} catch {
  // Optional; we'll fallback to copying if these aren't available
}

/** Recursively walk a directory and return file paths */
async function walk(dir) {
  /** @type {string[]} */
  const result = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    let entries;
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) result.push(p);
    }
  }
  return result;
}

/** Extract import specifiers from JS content */
function findImportSpecifiers(code) {
  const specs = new Set();
  const re = /(?:(?:import|export)\s+(?:[^'";]*?from\s+)?)['"]([^'"\n]+)['"]|import\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(code))) {
    const s = m[1] || m[2];
    if (s) specs.add(s);
  }
  return [...specs];
}

/** Normalize spec to a node_modules path, if present */
function toNodeModulesPath(spec) {
  // Examples we support:
  //   /ovum/node_modules/lodash-es/get.js
  //   /node_modules/lodash-es/get.js
  // Return the substring starting at 'node_modules/...'
  const idx = spec.indexOf('/node_modules/');
  if (idx === -1) return null;
  return spec.slice(idx + 1); // drop the leading slash so it starts with node_modules/
}

/** Derive package name from node_modules path. Handles scoped packages. */
function packageNameFromNodeModulesPath(nmPath) {
  // nmPath starts with: node_modules/<pkg>/...
  const parts = nmPath.split('/');
  if (parts.length < 2 || parts[0] !== 'node_modules') return null;
  if (parts[1].startsWith('@')) {
    // scoped package: node_modules/@scope/name/...
    if (parts.length >= 3) return parts[1] + '/' + parts[2];
    return null;
  } else {
    return parts[1];
  }
}

/** Copy directory recursively using fs.cp if available, otherwise a fallback */
async function copyDir(src, dest) {
  if (typeof fs.cp === 'function') {
    await fs.promises.mkdir(dest, { recursive: true });
    await fs.promises.cp(src, dest, { recursive: true, force: true });
    return;
  }
  // Fallback: simple recursive copy
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.promises.copyFile(s, d);
  }
}

// Externalize any relative import that resolves outside the project root (served by ComfyUI at runtime)
function externalizeOutsideRootPlugin() {
  /** @type {string} */
  let projectRoot = process.cwd();
  const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
  return {
    name: 'ovum-externalize-outside-root',
    apply: 'build',
    configResolved(config) {
      // Vite's resolved root
      projectRoot = path.resolve(config.root || projectRoot);
    },
    resolveId(id, importer) {
      if (!importer) return null;
      // Always externalize absolute ComfyUI-served paths like /scripts/... 
      if (id.startsWith('/scripts/')) {
        return { id, external: true };
      }
      // Handle only relative imports next
      if (!(id.startsWith('./') || id.startsWith('../'))) return null;
      const abs = path.resolve(path.dirname(importer), id);
      if (!norm(abs).startsWith(norm(projectRoot))) {
        // Mark as external so Vite/Rollup doesn't try to resolve it.
        return { id, external: true };
      }
      return null;
    }
  };
}

/** Vite plugin */
function copyUsedNodeModulesPlugin() {
  // Recursively collect relative file deps within the same package
  async function collectRelativeDeps(entryFileAbs, packageRootAbs, collected) {
    const norm = (p) => p.replace(/\\/g, '/');
    const q = [entryFileAbs];
    while (q.length) {
      const cur = q.pop();
      const curNorm = norm(cur);
      if (collected.has(curNorm)) continue;
      collected.add(curNorm);
      let code = '';
      try { code = await fsp.readFile(cur, 'utf8'); } catch { continue; }
      const specs = findImportSpecifiers(code);
      for (const s of specs) {
        if (!(s.startsWith('./') || s.startsWith('../'))) continue;
        const nextAbs = path.resolve(path.dirname(cur), s);
        // Only follow files that remain inside the same package root
        const inPkg = norm(nextAbs).startsWith(norm(packageRootAbs) + '/');
        if (!inPkg) continue;
        // Resolve extensions if import omits it
        let candidate = nextAbs;
        try {
          const st = await fsp.stat(candidate);
          if (st.isFile()) {
            q.push(candidate);
            continue;
          }
        } catch {}
        // Try adding .js
        try {
          const withJs = candidate + '.js';
          const st2 = await fsp.stat(withJs);
          if (st2.isFile()) { q.push(withJs); continue; }
        } catch {}
        // Try index.js in folder
        try {
          const idx = path.join(candidate, 'index.js');
          const st3 = await fsp.stat(idx);
          if (st3.isFile()) { q.push(idx); continue; }
        } catch {}
      }
    }
  }

  return {
    name: 'ovum-copy-used-node-modules',
    apply: 'build',
    async buildStart() {
      const root = process.cwd();
      const jsRoot = path.join(root, 'js');
      const outRoot = path.join(root, 'web', 'dist');
      const nodeModulesRoot = path.join(root, 'node_modules');
      console.log(`[ovum] Copying used node_modules packages from ${jsRoot} to ${outRoot}`);

      // Clean the output directory to avoid stale files left from previous runs
      try {
        await fs.promises.rm(outRoot, { recursive: true, force: true });
      } catch {}
      await fs.promises.mkdir(outRoot, { recursive: true });

      // Find all JS files under ./js
      const files = (await walk(jsRoot)).filter(p => p.endsWith('.js'));

      /** @type {Set<string>} */
      const pkgs = new Set();
      /** @type {Set<string>} absolute file paths to copy */
      const filesToCopy = new Set();

      // helper to normalize
      const norm = (p) => p.replace(/\\+/g, '/');

      for (const file of files) {
        let code = '';
        try { code = await fsp.readFile(file, 'utf8'); } catch { continue; }
        const specs = findImportSpecifiers(code);
        for (const s of specs) {
          const nm = toNodeModulesPath(s);
          if (!nm) continue;
          const pkg = packageNameFromNodeModulesPath(nm);
          if (pkg) pkgs.add(pkg);

          // Attempt to resolve to a concrete file in node_modules
          const absFromNm = path.join(root, nm); // starts with node_modules/...
          const absCandidate = absFromNm; // could be file or folder
          // If it's a file that exists, collect its relative deps within the package
          try {
            const st = await fsp.stat(absCandidate);
            if (st.isFile()) {
              const packageRootAbs = path.join(nodeModulesRoot, pkg);
              await collectRelativeDeps(absCandidate, packageRootAbs, filesToCopy);
              continue;
            }
          } catch {
            // Try with .js if missing
            try {
              const withJs = absCandidate + '.js';
              const st2 = await fsp.stat(withJs);
              if (st2.isFile()) {
                const packageRootAbs = path.join(nodeModulesRoot, pkg);
                await collectRelativeDeps(withJs, packageRootAbs, filesToCopy);
                continue;
              }
            } catch {}
          }
          // Fallback: copy whole package later
        }
      }

      if (pkgs.size === 0) {
        this.warn('[ovum] No /node_modules/ imports found in ./js');
        return;
      }

      // Copy strategy:
      // - If we discovered specific files to copy for a package, copy only those (and their folders)
      // - Otherwise, copy the entire package as before
      // Group files by package
      /** @type {Map<string, string[]>} */
      const filesByPkg = new Map();
      for (const absFile of filesToCopy) {
        // Determine package name by finding segment after node_modules
        const parts = norm(absFile).split('/');
        const nmIdx = parts.lastIndexOf('node_modules');
        if (nmIdx === -1 || nmIdx + 1 >= parts.length) continue;
        const pkgName = parts[nmIdx + 1].startsWith('@') ? parts[nmIdx + 1] + '/' + parts[nmIdx + 2] : parts[nmIdx + 1];
        if (!filesByPkg.has(pkgName)) filesByPkg.set(pkgName, []);
        filesByPkg.get(pkgName).push(absFile);
      }

      for (const pkg of pkgs) {
        // Special case: bundle CJS-only 'braces' package into a single ESM index.js
        if (pkg === 'braces') {
          const srcEntry = path.join(nodeModulesRoot, 'braces', 'index.js');
          const destDir = path.join(outRoot, 'node_modules', 'braces');
          const destFile = path.join(destDir, 'index.js');
          await fs.promises.mkdir(destDir, { recursive: true });
          if (rollupBundle && commonjs && nodeResolve) {
            try {
              const bundle = await rollupBundle({
                input: srcEntry,
                plugins: [
                  // Map Node builtins used by CJS to empty/browser-safe shims
                  ...(alias ? [alias({ entries: [
                    { find: /^util(?:\?commonjs-external)?$/, replacement: path.posix.join(root.replace(/\\+/g, '/'), 'js', 'common', 'empty-util.js') },
                  ] })] : []),
                  nodeResolve({ browser: true, preferBuiltins: false }),
                  commonjs(),
                ],
                onwarn: (w, def) => {
                  // Reduce noise but keep important warnings
                  if (w.code === 'CIRCULAR_DEPENDENCY') return;
                  def(w);
                },
              });
              await bundle.write({
                file: destFile,
                format: 'esm',
                exports: 'named',
                sourcemap: false,
              });
              await bundle.close();
              this.info(`[ovum] Bundled braces -> ${path.relative(root, destFile)}`);
              continue; // handled
            } catch (e) {
              this.warn(`[ovum] Failed to bundle braces, falling back to copy: ${e?.message || e}`);
            }
          } else {
            this.warn('[ovum] Rollup plugins not available to bundle braces; falling back to copying package');
          }
          // Fallback: copy entire package
          try {
            await copyDir(path.join(nodeModulesRoot, 'braces'), destDir);
            this.info(`[ovum] Copied braces -> ${path.relative(root, destDir)}`);
          } catch (e) {
            this.warn(`[ovum] Failed to copy braces: ${e?.message || e}`);
          }
          continue;
        }

        const specificFiles = filesByPkg.get(pkg);
        if (specificFiles && specificFiles.length) {
          // Copy only specific files
          for (const srcFile of specificFiles) {
            const relFromNm = norm(srcFile).split('/node_modules/')[1];
            const destFile = path.join(outRoot, 'node_modules', relFromNm);
            await fs.promises.mkdir(path.dirname(destFile), { recursive: true });
            try {
              await fs.promises.copyFile(srcFile, destFile);
              this.info(`[ovum] Copied file ${path.relative(root, srcFile)} -> ${path.relative(root, destFile)}`);
            } catch (e) {
              this.warn(`[ovum] Failed to copy file ${srcFile}: ${e?.message || e}`);
            }
          }
        } else {
          // Fallback to whole package copy
          const srcDir = path.join(nodeModulesRoot, pkg);
          const destDir = path.join(outRoot, 'node_modules', pkg);
          try {
            const stat = await fsp.stat(srcDir);
            if (!stat.isDirectory()) {
              this.warn(`[ovum] Skipping ${pkg}: not a directory at ${srcDir}`);
              continue;
            }
            await copyDir(srcDir, destDir);
            this.info(`[ovum] Copied ${pkg} -> ${path.relative(root, destDir)}`);
          } catch (e) {
            this.warn(`[ovum] Failed to copy ${pkg}: ${e?.message || e}`);
          }
        }
      }
    },
  };
}

/** @type {import('vite').UserConfig} */
const baseConfig = {
  // Default mode: copy used node_modules only
  build: {
    outDir: 'js/.vite-tmp',
    emptyOutDir: false,
    rollupOptions: {
      // Provide a minimal dummy input so Vite runs; it won’t be used for output you care about.
      // You can point this at any small JS file in your repo.
      input: 'js/05/spotlight-typedefs.js',
      output: {
        // Avoid clutter; single file name for the dummy chunk.
        entryFileNames: 'noop.js',
        assetFileNames: 'assets/[name][extname]'
      },
      external: (id, importer) => {
        if (!importer) return false;
        // Externalize absolute ComfyUI-served paths like /scripts/...
        if (typeof id === 'string' && id.startsWith('/scripts/')) return true;
        if (!(id.startsWith('./') || id.startsWith('../'))) return false;
        const norm = (p) => p.replace(/\\+/g, '/').toLowerCase();
        const abs = path.resolve(path.dirname(importer), id);
        const root = path.resolve(process.cwd());
        return !norm(abs).startsWith(norm(root));
      }
    }
  },
  plugins: [externalizeOutsideRootPlugin(), copyUsedNodeModulesPlugin(), tailwindcss()],
};

/** CSS build variant: outputs processed Tailwind CSS into web/css/ */
function cssBuildConfig() {
  /** @type {import('vite').UserConfig} */
  return {
    build: {
      outDir: 'web/css',
      emptyOutDir: false,
      rollupOptions: {
        input: 'styles/tailwind.css',
        output: {
          // ensure file name is stable
          assetFileNames: '[name][extname]'
        }
      }
    },
    plugins: [tailwindcss()],
  };
}

/** Export conditional config based on mode */
export default ({ mode }) => {
  if (mode === 'css') return cssBuildConfig();
  return baseConfig;
};
