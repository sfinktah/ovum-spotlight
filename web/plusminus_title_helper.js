import { app } from "/scripts/app.js";

app.registerExtension({
  name: "ovum.plusminus.title",
  nodeCreated(node) {
    try {
      if (node?.type === "PlusOne") {
        node.title = "+1";
      } else if (node?.type === "MinusOne") {
        node.title = "-1";
      } else {
        return; // only handle PlusOne/MinusOne below
      }

      // Collapse once when both an input and an output are connected for the first time
      const hasAnyInputConnected = (n) =>
        Array.isArray(n.inputs) && n.inputs.some((inp) => inp && (inp.link != null || (Array.isArray(inp.links) && inp.links.length > 0)));

      const hasAnyOutputConnected = (n) =>
        Array.isArray(n.outputs) && n.outputs.some((out) => out && Array.isArray(out.links) && out.links.length > 0);

      const collapseIfReady = () => {
        if (node.__ovumCollapsedOnce) return;
        if (hasAnyInputConnected(node) && hasAnyOutputConnected(node)) {
          try {
            if (typeof node.collapse === "function") {
              node.collapse(true);
            } else {
              node.flags = node.flags || {};
              node.flags.collapsed = true;
            }
            node.__ovumCollapsedOnce = true;
            if (app?.canvas?.setDirty) app.canvas.setDirty(true, true);
          } catch (_) {
            // ignore collapse errors
          }
        }
      };

      // Wrap onConnectionsChange to detect connectivity transitions
      const originalOnConnectionsChange = node.onConnectionsChange?.bind(node);
      node.onConnectionsChange = function (...args) {
        try {
          if (originalOnConnectionsChange) originalOnConnectionsChange(...args);
        } finally {
          collapseIfReady();
        }
      };

      // Also run an initial check in case the node is deserialized with connections
      setTimeout(collapseIfReady, 0);
    } catch (e) {
      // no-op
    }
  },
});
