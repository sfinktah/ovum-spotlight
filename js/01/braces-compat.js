// braces-compat.js (ESM) - works with both ESM and CJS builds of braces
import * as _mod from '/ovum-spotlight/node_modules/braces/index.js';
const braces = (_mod && 'default' in _mod) ? _mod.default : _mod;
window.braces = braces;
export { braces };
