// Ambient type declarations for non-code assets webpack handles via
// asset/resource (e.g. SVGs). Without these, importing an SVG in TS would fail
// typecheck even though webpack bundles it.
declare module '*.svg' {
  const url: string;
  export default url;
}
