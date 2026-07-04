import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";
const buildOnce = prod || process.argv[2] === "build-dev";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    "fs",
    "path",
    "http",
    "https",
    "crypto",
    "net",
    "zlib",
    "stream",
    "url",
    "child_process",
    "os",
  ],
  define: {
    // 开发构建 = true，生产构建 = false，源码无需手动改
    DEV_MODE: prod ? "false" : "true",
  },
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (buildOnce) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
