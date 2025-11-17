import re
from comfy.comfy_types.node_typing import IO

class NewPointer:
    """A base class that forces ComfyUI to skip caching by returning NaN in IS_CHANGED."""
    RESULT_NODE = True  # Typically means the node can appear as a "result" in the graph
    OUTPUT_NODE = True  # Typically means the node can appear as an "output" in the graph

    @classmethod
    def IS_CHANGED(cls, *args, **kwargs):
        return float("NaN")  # Forces ComfyUI to consider it always changed


class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False

class TautologyStr(str):
    def __ne__(self, other):
        return False

class ByPassTypeTuple(tuple):
    def __getitem__(self, index):
        if index>0:
            index=0
        item = super().__getitem__(index)
        if isinstance(item, str):
            return TautologyStr(item)
        return item


# noinspection DuplicatedCode
class MultiType(str):
    def __ne__(self, value: object) -> bool:
        if self == "*" or value == "*":
            return False
        if not isinstance(value, str):
            return True
        a = frozenset(self.split(","))
        b = frozenset(value.split(","))
        return not (b.issubset(a) or a.issubset(b))


ANYTYPE = AnyType("*")


def _parse_optional_int(value, field_name: str):
    """Parse optional integer from a widget string.
    Returns int or None. Treats None/''/whitespace-only as None.
    Raises ValueError for non-integer non-blank values (e.g., '1.5', 'abc').
    """
    if value is None:
        return None
    if isinstance(value, list):
        if len(value) != 1:
            raise ValueError(f"{field_name} must be a single integer, got list of length {len(value)}.")
        value = value[0]
    # Explicitly reject booleans (bool is subclass of int)
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be an integer (blank for unset), got type {type(value)}.")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        s = value.strip()
        if s == "":
            return None
        if re.fullmatch(r"[+-]?\d+", s):
            return int(s)
        raise ValueError(f"{field_name} must be an integer (blank for unset), got '{value}'.")
    # Reject floats and other types
    raise ValueError(f"{field_name} must be an integer (blank for unset), got type {type(value)}.")
