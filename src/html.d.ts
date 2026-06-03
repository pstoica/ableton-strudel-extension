declare module "*.html" {
  const content: string;
  export default content;
}
declare module "*.js" {
  const content: string;
  export default content;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module "@strudel/core"  { export function evalScope(...args: any[]): Promise<any[]>; }
declare module "@strudel/mini"  { const _default: unknown; export default _default; }
declare module "@strudel/tonal" { const _default: unknown; export default _default; }
