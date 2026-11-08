import { build } from "esbuild";

await build({
  entryPoints: ["web/main.ts"],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  outfile: "public/app.js",
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  logLevel: "info",
});
