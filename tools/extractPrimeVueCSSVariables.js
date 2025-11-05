// JavaScript
(() => {
  // Heuristics for PrimeVue variable names; adjust if needed
  const PV_PREFIXES = [
    '--primary',
    '--surface',
    '--text',
    '--highlight',
    '--success',
    '--warning',
    '--error',
    '--info',
    '--content',
    '--overlay',
    '--focus',
    '--border',
  ];
  const PV_CONTAINS = [
    'prime', // in case theme uses --p- vars or prefixed names
    'color',
    'bg',
    'surface',
  ];

  const root = document.documentElement;
  const body = document.body;

  function getAllCSSVarsFrom(el) {
    const styles = getComputedStyle(el);
    const vars = {};
    for (let i = 0; i < styles.length; i++) {
      const name = styles[i];
      if (name.startsWith('--')) {
        vars[name] = styles.getPropertyValue(name).trim();
      }
    }
    return vars;
  }

  function mergeVars(...maps) {
    const out = {};
    for (const m of maps) {
      for (const [k, v] of Object.entries(m)) {
        // Prefer first non-empty value encountered
        if (!(k in out) || out[k] === '' || out[k] == null) {
          out[k] = v;
        }
      }
    }
    return out;
  }

  function isPrimeVueLike(name) {
    const n = name.toLowerCase();
    if (!n.startsWith('--')) return false;
    if (PV_PREFIXES.some(p => n.startsWith(p))) return true;
    if (PV_CONTAINS.some(c => n.includes(c))) return true;
    // Common token patterns seen in PV themes
    if (/(^|-)primary(-|$)/.test(n)) return true;
    if (/(^|-)surface(-|$)/.test(n)) return true;
    if (/(^|-)text(-|$)/.test(n)) return true;
    if (/(^|-)highlight(-|$)/.test(n)) return true;
    if (/(^|-)success|warning|error|info(-|$)/.test(n)) return true;
    return false;
  }

  // Collect from :root and body, merge with :root precedence
  const rootVars = getAllCSSVarsFrom(root);
  const bodyVars = getAllCSSVarsFrom(body);
  const allVars = mergeVars(rootVars, bodyVars);

  // Try to capture variables defined in stylesheets too (rarely necessary but helpful)
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule.selectorText && (/:root/.test(rule.selectorText) || /body/.test(rule.selectorText))) {
          const style = rule.style;
          if (!style) continue;
          for (let i = 0; i < style.length; i++) {
            const name = style[i];
            if (name.startsWith('--')) {
              const value = style.getPropertyValue(name).trim();
              if (value && !(name in allVars)) {
                allVars[name] = value;
              }
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  const pvVars = Object.fromEntries(
    Object.entries(allVars)
      .filter(([k]) => isPrimeVueLike(k))
      .sort(([a], [b]) => a.localeCompare(b))
  );

  // Log a table for quick visual inspection
  console.group('PrimeVue-like CSS Variables');
  console.table(
    Object.entries(pvVars).map(([k, v]) => ({ name: k, value: v }))
  );
  console.groupEnd();

  // Provide a neat JSON blob to copy
  const json = JSON.stringify(pvVars, null, 2);
  console.log('JSON (copy this):\n', json);

  // Also return it from the IIFE so devtools shows it as result
  return pvVars;
})();
