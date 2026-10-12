// Bundles src/studio-plugin.ts into build/main.js and the stylesheet into styles.css.
//   node esbuild.config.mjs              watch mode, inline source maps
//   node esbuild.config.mjs production   one minified build
import esbuild from "esbuild";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { deflateRawSync } from "node:zlib";
import prettier from "prettier";

const production = process.argv[2] === "production";

// Obsidian loads styles.css from the plugin folder, so the CSS esbuild writes next to the bundle
// is moved to the repository root, stripped of its source map comment and formatted.
const cssToRoot = {
    name: "css-to-root",
    setup(build) {
        build.onEnd(async () => {
            const bundled = "build/main.css";
            if (!existsSync(bundled)) return;
            const css = readFileSync(bundled, "utf8").replace(
                /\/\*#\s*sourceMappingURL=.*?\*\/\s*$/s,
                "",
            );
            writeFileSync("styles.css", await prettier.format(css, { filepath: "styles.css" }));
            rmSync(bundled);
            console.log("styles.css written");
        });
    },
};

// A .wasm import becomes a base64 string of the deflated bytes, so the plugin stays one main.js file.
// The Anki import and export code inflates it when it is first needed.
const wasmAsText = {
    name: "wasm-as-text",
    setup(build) {
        build.onLoad({ filter: /\.wasm$/ }, ({ path }) => {
            const packed = deflateRawSync(readFileSync(path), { level: 9 }).toString("base64");
            return { contents: `export default ${JSON.stringify(packed)};`, loader: "js" };
        });
    },
};

// ankipack imports node:fs/promises inside a function the plugin never calls. Resolving every
// node: import to an empty module keeps main.js free of Node imports, which mobile cannot load.
const emptyNodeModules = {
    name: "empty-node-modules",
    setup(build) {
        build.onResolve({ filter: /^node:/ }, ({ path }) => ({ path, namespace: "empty-node" }));
        build.onLoad({ filter: /.*/, namespace: "empty-node" }, () => ({
            contents: "export default {};",
            loader: "js",
        }));
    },
};

const ctx = await esbuild.context({
    entryPoints: ["src/studio-plugin.ts"],
    outfile: "build/main.js",
    bundle: true,
    format: "cjs",
    target: "es2018",
    external: ["obsidian", "electron", ...builtinModules],
    loader: { ".css": "css" },
    treeShaking: true,
    minify: production,
    sourcemap: production ? false : "inline",
    sourcesContent: !production,
    logLevel: "info",
    plugins: [wasmAsText, emptyNodeModules, cssToRoot],
});

if (production) {
    // rebuild() resolves only after the onEnd hooks have finished, so styles.css is complete here
    try {
        await ctx.rebuild();
    } catch {
        process.exitCode = 1;
    } finally {
        await ctx.dispose();
    }
} else {
    await ctx.watch().catch(() => process.exit(1));
}
