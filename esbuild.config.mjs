import console from "console";
import esbuild from "esbuild";
import fs from "fs";
import { builtinModules } from "node:module";
import path from "path";
import prettier from "prettier";
import process from "process";
import { deflateRawSync } from "zlib";

const prod = process.argv[2] === "production";

// The published plugin expects CSS at the repository root, not under build/.
// We also normalize the generated stylesheet through Prettier so CI does not
// fail on formatting differences introduced by the bundler output.
const moveToRootPlugin = {
    name: "move-to-root",
    setup(build) {
        build.onEnd(async (_) => {
            const cssFile = path.join("build", "main.css");
            const targetFile = "styles.css";

            if (fs.existsSync(cssFile)) {
                let contents = fs.readFileSync(cssFile, "utf8");
                // Remove source map comment
                contents = contents.replace(/\/\*#\s*sourceMappingURL=.*?\*\/\s*$/s, "");
                contents = await prettier.format(contents, { filepath: targetFile });
                fs.writeFileSync(targetFile, contents);
                fs.rmSync(cssFile);

                console.log(`✓ CSS bundled to ${targetFile}`);
            }
        });
    },
};

// Embeds .wasm files as deflate-compressed base64 text, so the plugin still ships as a single main.js
// (Obsidian installs only main.js, manifest.json and styles.css). The Anki import and export code decodes and
// inflates the sql.js binary lazily, when an import or export starts. Compression takes the 658 kB binary to
// about 430 kB of base64 in the bundle.
const embedWasmPlugin = {
    name: "embed-wasm",
    setup(build) {
        build.onLoad({ filter: /\.wasm$/ }, (args) => {
            const compressed = deflateRawSync(fs.readFileSync(args.path), { level: 9 });
            return {
                contents: `export default ${JSON.stringify(compressed.toString("base64"))};`,
                loader: "js",
            };
        });
    },
};

// ankipack reads node:fs/promises with a dynamic import, but only in Package.writeToFile, which the plugin never
// calls (it saves through the vault API). The import is replaced by an empty module, so main.js has no Node import,
// which the plugin has to work on mobile without.
const stubNodeImportsPlugin = {
    name: "stub-node-imports",
    setup(build) {
        build.onResolve({ filter: /^node:/ }, (args) => ({
            path: args.path,
            namespace: "stub-node",
        }));
        build.onLoad({ filter: /.*/, namespace: "stub-node" }, () => ({
            contents: "export default {};",
            loader: "js",
        }));
    },
};

const context = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron", ...builtinModules],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    sourcesContent: !prod,
    minify: prod,
    treeShaking: true,
    outfile: "build/main.js",
    loader: {
        ".css": "css",
    },
    plugins: [embedWasmPlugin, stubNodeImportsPlugin, moveToRootPlugin],
});

if (prod) {
    try {
        // Production mode must await rebuild/dispose so async post-processing of
        // styles.css has finished before the process exits.
        await context.rebuild();
    } catch {
        process.exit(1);
    } finally {
        await context.dispose();
    }
} else {
    context.watch().catch(() => process.exit(1));
}
