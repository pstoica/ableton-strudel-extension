import * as esbuild from "esbuild";
import * as fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");
const watch      = process.argv.includes("--watch");

// ── 1. Browser bundle: Strudel init (runs in the eval webview) ───────────────
// esbuild bundles for browser target fine even though @strudel/core imports
// @kabelsalat/web — the kabelsalat error only happens at Node *runtime*, not
// at esbuild bundle time.
await esbuild.build({
  entryPoints: ["src/strudel-init.ts"],
  outfile: "src/strudel-bundle.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  minify: production,
  logLevel: "info",
});

// ── 2. Node extension bundle ──────────────────────────────────────────────────
const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  outfile: manifest.entry,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  loader: { ".html": "text", ".js": "text" }, // inline eval.html + strudel-bundle.js
});

if (watch) {
  await ctx.watch();
  console.log("Watching — restart extensions-cli run once, then edits auto-reload.");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
