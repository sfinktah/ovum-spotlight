// ComfyNode.d.ts

import type { LGraphNode } from "@comfyorg/comfyui-frontend-types";

/**
 * ComfyNode extends LGraphNode with additional ComfyUI-specific behaviors and callbacks.
 * Only Comfy-specific additions are declared here to avoid redeclaring LGraphNode methods.
 * Partially sourced mtb/types/shared.d.ts
 */
export interface ComfyNode extends LGraphNode {
    // Extra utilities / deprecations
    prototype: any;
    /** @deprecated */
    convertWidgetToInput(): boolean;
    /** @deprecated */
    setSizeForImage(): void;
    category: str
    comfyClass: str
    length: 0
    name: str
    nodeData: NodeData
    title: str
}

// From mtb/types/shared.d.ts
export interface NodeData {
  category: str
  description: str
  display_name: str
  input: NodeInput
  name: str
  output: [str]
  output_is_list: [boolean]
  output_name: [str]
  output_node: boolean
}

