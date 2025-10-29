from __future__ import annotations

import filecmp
import logging
import os
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

logger = logging.getLogger(__name__)

try:
    import folder_paths  # type: ignore
except Exception:  # pragma: no cover
    logger.warning("[ovum-spotlight] folder_paths not found, using cwd fallback for user directory")

    class _FolderPaths:
        @staticmethod
        def get_user_directory() -> str:
            return os.path.abspath(os.path.join(os.getcwd(), "user"))

    folder_paths = _FolderPaths()  # type: ignore


# Replacement rules applied to the CONTENT of any file that originates from a link: source
# Keys are exact substrings to search for; values are replacements.
LINK_CONTENT_REPLACEMENTS: Dict[str, str] = {
    'import("./spotlight-typedefs.js")': 'import("../typedefs/spotlight-typedefs.js")',
    # Additional replacements can be added here later.
}


# Subdirectories to create under the user_plugins directory
REQUIRED_SUBDIRS: Tuple[str, ...] = (
    'typedefs',
    'samples/filters',
    'samples/keywords',
    'samples/search',
    'samples/selection_commands',
    'samples/includes',
)


def _ensure_dirs(base: Path) -> None:
    base.mkdir(parents=True, exist_ok=True)
    for rel in REQUIRED_SUBDIRS:
        (base / rel).mkdir(parents=True, exist_ok=True)


def _iter_files(root: Path) -> Iterable[Path]:
    for p in root.rglob('*'):
        if p.is_file():
            yield p


def _read_text_any(p: Path) -> str:
    try:
        return p.read_text(encoding='utf-8')
    except Exception:
        return p.read_text()


def _write_text_any(p: Path, text: str) -> None:
    try:
        p.write_text(text, encoding='utf-8')
    except Exception:
        p.write_text(text)


def _same_file(src: Path, dst: Path) -> bool:
    try:
        if not dst.exists():
            return False
        # Fast path: compare size then fallback to full comparison
        if src.stat().st_size != dst.stat().st_size:
            return False
        return filecmp.cmp(str(src), str(dst), shallow=False)
    except Exception:
        return False


def _apply_replacements(text: str, replacements: Dict[str, str]) -> str:
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def _copy_file_with_compare(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if _same_file(src, dst):
        return
    data = src.read_bytes()
    dst.write_bytes(data)


def _extract_headers_and_target(src: Path) -> Tuple[Path, List[str], bool]:
    """
    Returns: (actual_source_path, extra_header_lines, is_link)
    If file starts with a line "link:<path>", treat <path> as the source file instead.
    Any subsequent lines at the top that look like "Word: details" will be logged.
    """
    try:
        with src.open('r', encoding='utf-8') as f:
            lines = f.read().splitlines()
    except Exception:
        try:
            with src.open('r') as f:
                lines = f.read().splitlines()
        except Exception:
            return src, [], False

    if not lines:
        return src, [], False

    first = lines[0].strip()
    if first.lower().startswith('link:'):
        # Collect additional header-like lines to log
        extras: List[str] = []
        for line in lines[1:10]:  # scan a small header region
            s = line.strip()
            if not s:
                break
            if ':' in s:
                key = s.split(':', 1)[0]
                if key and key.replace('_', '').replace('-', '').isalpha():
                    extras.append(s)
                else:
                    break
            else:
                break
        try:
            link_target = Path(first.split(':', 1)[1].strip())
        except Exception:
            link_target = src
        return link_target, extras, True

    return src, [], False


def _copy_tree_with_links(src_root: Path, dst_root: Path) -> None:
    for src in _iter_files(src_root):
        rel = src.relative_to(src_root)
        dst = dst_root / rel
        # Determine actual source (handle link: header)
        actual_src, extra_lines, is_link = _extract_headers_and_target(src)
        if extra_lines:
            for line in extra_lines:
                logger.info("[ovum-spotlight] user_plugins.default header: %s :: %s", rel.as_posix(), line)
        if is_link:
            # Resolve link target relative to the file it was found in
            abs_target = actual_src if actual_src.is_absolute() else (src.parent / actual_src).resolve()
            # Read content from actual file and apply replacements
            if not abs_target.exists():
                logger.warning("[ovum-spotlight] Linked source not found for %s: %s", rel, abs_target)
                # Fall back to copying original if available
                _copy_file_with_compare(src, dst)
                continue
            try:
                content = _read_text_any(abs_target)
            except Exception as e:
                logger.warning("[ovum-spotlight] Failed to read linked source %s for %s: %s", abs_target, rel, e)
                # Fall back to copying original if available
                _copy_file_with_compare(src, dst)
                continue
            transformed = _apply_replacements(content, LINK_CONTENT_REPLACEMENTS)
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                prev = dst.read_text(encoding='utf-8') if dst.exists() else None
            except Exception:
                prev = dst.read_text() if dst.exists() else None
            if prev == transformed:
                continue
            _write_text_any(dst, transformed)
        else:
            _copy_file_with_compare(src, dst)


def ensure_user_plugins_initialized() -> Path:
    """
    Ensure the spotlight user_plugins directory structure exists and that default
    files from user_plugins.default are copied over without unnecessarily overwriting.

    Returns the absolute Path to the user_plugins directory.
    """
    user_base = Path(folder_paths.get_user_directory()).resolve() / 'spotlight' / 'user_plugins'
    _ensure_dirs(user_base)

    # Copy defaults if source exists alongside this module
    src_default = Path(__file__).resolve().parent / 'user_plugins.default'
    if src_default.exists() and src_default.is_dir():
        try:
            _copy_tree_with_links(src_default, user_base)
        except Exception as e:
            logger.warning("[ovum-spotlight] Failed to copy user_plugins.default: %s", e)
    else:
        logger.info("[ovum-spotlight] user_plugins.default not found at %s (skipping copy)", src_default)

    return user_base


# Execute on import, but swallow errors so extension still loads
try:  # pragma: no cover
    ensure_user_plugins_initialized()
except Exception as _e:
    logger.warning("[ovum-spotlight] setup_user_plugins initialization failed: %s", _e)
