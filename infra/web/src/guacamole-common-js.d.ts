// Type shim for guacamole-common-js, which ships without bundled TypeScript types.
// This declares the library as an untyped module so the components that use it
// (GuacamoleClient, KasmVNCClient) can import it under strict mode. Replace with
// real types if a @types package becomes available.
declare module 'guacamole-common-js' {
  const Guacamole: any;
  export default Guacamole;
}
