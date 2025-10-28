// Minimal browser-safe shim for Node's 'util' module used by some CJS bundles
// We export a no-op default object and a few commonly referenced helpers.
export default {};

export const types = {};
export const inherits = function inherits() { /* no-op in browser */ };
export const deprecate = function deprecate(fn /*, msg */) { return fn; };
export const promisify = function promisify(fn) {
  return (...args) => new Promise((resolve, reject) => {
    fn(...args, (err, res) => err ? reject(err) : resolve(res));
  });
};
