from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Iterable, List, Dict

# noinspection PyPackageRequirements
from aiohttp import web
# noinspection PyUnresolvedReferences,PyPackageRequirements
from server import PromptServer

logger = logging.getLogger(__name__)

try:
    # Prefer ComfyUI's real folder_paths if available
    import folder_paths  # type: ignore
except Exception:  # pragma: no cover - fallback for dev environments
    logger.warning("[ovum-spotlight] folder_paths not found, using cwd fallback for user directory")

    class _FolderPaths:
        @staticmethod
        def get_user_directory() -> str:
            # Default to a .comfy directory under CWD for dev
            return os.path.abspath(os.path.join(os.getcwd(), "user"))

    folder_paths = _FolderPaths()  # type: ignore


# Compute base directory for Spotlight user plugins
USER_PLUGINS_DIR = Path(folder_paths.get_user_directory()).resolve() / "spotlight" / "user_plugins"


def _is_subpath(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except Exception:
        return False


def _walk_js_files(root: Path) -> Iterable[Path]:
    """
    Recursively yield .js files under root, excluding any file or directory
    that starts with '.' or '_'.
    """
    if not root.exists():
        return []
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            for entry in d.iterdir():
                name = entry.name
                if name.startswith('.') or name.startswith('_'):
                    continue
                if entry.is_dir():
                    stack.append(entry)
                elif entry.is_file() and entry.suffix.lower() == '.js':
                    yield entry
        except Exception as e:
            logger.warning("[ovum-spotlight] Error reading directory %s: %s", d, e)


def _relative_posix(path: Path, base: Path) -> str:
    rel = path.resolve().relative_to(base.resolve())
    return "/".join(rel.parts)


API_BASE = "/spotlight/user_plugins"


@PromptServer.instance.routes.get(f"{API_BASE}/{{tail:.*}}")
async def spotlight_user_plugins(request: web.Request):
    """
    Serves Spotlight user plugins. When the target is a directory (including empty tail),
    returns a JSON listing of all .js files recursively below that directory, excluding
    entries beginning with '.' or '_'. When the target is a file, serves the file bytes.

    Response for directory:
    {"base": "/ovum-spotlight/user_plugins", "files": [{"path": "samples/keywords/foo.js", "url": "/ovum-spotlight/user_plugins/samples/keywords/foo.js"}, ...]}
    """
    tail = request.match_info.get("tail", "").strip()
    # Normalize tail to a safe relative Path (prevent traversal)
    safe_tail = Path(*(p for p in Path(tail).parts if p not in ("..", "")))
    target = (USER_PLUGINS_DIR / safe_tail).resolve()

    # Enforce sandbox under USER_PLUGINS_DIR
    if not _is_subpath(target, USER_PLUGINS_DIR):
        return web.Response(status=403, text="Forbidden")

    # If directory → return recursive listing
    if target.is_dir():
        try:
            files: List[Dict[str, str]] = []
            for f in _walk_js_files(target):
                rel = _relative_posix(f, USER_PLUGINS_DIR)
                files.append({
                    "path": rel,
                    "url": f"{API_BASE}/{rel}",
                })
            body = json.dumps({"base": API_BASE, "files": files})
            return web.Response(text=body, content_type="application/json")
        except Exception as e:
            logger.exception("[ovum-spotlight] Failed to list user plugins: %s", e)
            return web.json_response({"error": True, "message": str(e)}, status=500)

    # If file → serve
    if target.is_file():
        # Only allow .js files to be served from this endpoint
        if target.suffix.lower() != ".js":
            return web.Response(status=403, text="Forbidden: only .js allowed")
        try:
            return web.FileResponse(path=target)
        except Exception as e:
            logger.exception("[ovum-spotlight] Failed to serve user plugin %s: %s", target, e)
            return web.Response(status=500, text="Internal Server Error")

    # If tail empty but path doesn't exist yet, treat as directory listing of root
    if tail == "":
        try:
            files = []
            if USER_PLUGINS_DIR.exists():
                for f in _walk_js_files(USER_PLUGINS_DIR):
                    rel = _relative_posix(f, USER_PLUGINS_DIR)
                    files.append({"path": rel, "url": f"{API_BASE}/{rel}"})
            body = json.dumps({"base": API_BASE, "files": files})
            return web.Response(text=body, content_type="application/json")
        except Exception as e:
            logger.exception("[ovum-spotlight] Failed to list root user plugins: %s", e)
            return web.json_response({"error": True, "message": str(e)}, status=500)

    return web.Response(status=404, text="Not Found")
