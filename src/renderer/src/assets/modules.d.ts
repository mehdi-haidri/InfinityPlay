// TypeScript 7 rejects a side-effect import whose module has no declaration (TS2882),
// so the non-code assets the renderer imports for their effect are declared here.

declare module "*.css";

// Fontsource packages ship CSS with a `main` of index.css and carry no types.
declare module "@fontsource-variable/outfit";
