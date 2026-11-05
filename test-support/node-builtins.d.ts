/** Minimal declarations for Node's built-in test APIs; keeps engine tests independent of @types/node. */
declare module 'node:test' {
  const test: (name: string, fn: (...args: any[]) => any) => void;
  export default test;
}
declare module 'node:assert' {
  const assert: any;
  export default assert;
}
declare module 'node:assert/strict' {
  const assert: any;
  export default assert;
}
