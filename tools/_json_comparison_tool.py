# Python
import json
from pathlib import Path
from typing import Any

LEFT = Path(r"C:\Users\sfink\AppData\Roaming\JetBrains\PyCharm2025.2\scratches\scratch_42.txt")
RIGHT = Path(r"C:\Users\sfink\AppData\Roaming\JetBrains\PyCharm2025.2\scratches\scratch_43.txt")

def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

def compare(a: Any, b: Any, prefix: str = "", include_missing: bool = False):
    if type(a) != type(b):
        print(f"{prefix}: {a!r} -> {b!r}")
        return

    if isinstance(a, dict):
        keys = set(a.keys()) | set(b.keys())
        for k in sorted(keys):
            in_a, in_b = k in a, k in b
            key_path = f"{prefix}.{k}" if prefix else k
            if in_a and in_b:
                compare(a[k], b[k], key_path, include_missing)
            elif include_missing:
                side = "missing-left" if not in_a else "missing-right"
                val = b[k] if in_a is False else a[k]
                print(f"{key_path}: {side} {val!r}")
        return

    if isinstance(a, list):
        max_len = max(len(a), len(b))
        for i in range(max_len):
            idx_path = f"{prefix}[{i}]"
            if i >= len(a) or i >= len(b):
                if include_missing:
                    side = "missing-left" if i >= len(a) else "missing-right"
                    val = b[i] if i < len(b) else a[i]
                    print(f"{idx_path}: {side} {val!r}")
                continue
            compare(a[i], b[i], idx_path, include_missing)
        return

    # Primitive values
    if a != b:
        print(f"{prefix}: {a!r} -> {b!r}")

def main():
    left = load_json(LEFT)
    right = load_json(RIGHT)
    compare(left, right, include_missing=False)

if __name__ == "__main__":
    main()
