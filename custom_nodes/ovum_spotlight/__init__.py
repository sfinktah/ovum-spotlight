try:
    from . import spotlight_routes  # noqa: F401
except Exception as e:
    import logging
    logging.getLogger(__name__).warning("[ovum-spotlight] failed to init spotlight routes: %s", e)

try:
    from .spotlight_sample_node import CLAZZES as _CLAZZES  # noqa: F401
except Exception:
    _CLAZZES = []

NODE_CLASS_MAPPINGS = {c.__name__: c for c in _CLAZZES}
