from common_types import ANYTYPE

class SpotlightSampleNode:
    """
    A minimal demo node for Spotlight plugin API. Does nothing server-side; exists to showcase
    that custom nodes can also extend the frontend spotlight search.
    """
    CATEGORY = "ovum/demo"
    RETURN_TYPES = (ANYTYPE,)
    RETURN_NAMES = ("any",)
    FUNCTION = "identity"
    NAME = "Spotlight Sample Node"

    @classmethod
    def INPUT_TYPES(cls):
        return {"optional": {"any": (ANYTYPE,)}}

    @classmethod
    def identity(cls, any=None):
        return (any,)


CLAZZES = [SpotlightSampleNode]
