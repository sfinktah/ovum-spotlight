// Ambient typing for ComfyUI app import used across Ovum JS files
// This provides IDE autocomplete for `import { app } from "../../../scripts/app.js"`.
// It binds the exported `app` symbol to the ComfyApp type from @comfyorg/comfyui-frontend-types.

import type {ComfyApi, ComfyApp} from "@comfyorg/comfyui-frontend-types";

declare module "../../../scripts/app.js" {
  export const app: ComfyApp;
}
declare module "../../../scripts/api.js" {
    export const api: ComfyApi;
}

/*
 * Note: the acutal contents of app.js at the time of writing are:
 * // Shim for scripts/app.ts
 * export const ANIM_PREVIEW_WIDGET = window.comfyAPI.app.ANIM_PREVIEW_WIDGET;
 * export const ComfyApp = window.comfyAPI.app.ComfyApp;
 * export const app = window.comfyAPI.app.app;
 */