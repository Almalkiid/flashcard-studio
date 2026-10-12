// Copies the built plugin into .e2e-plugin/ in the layout wdio-obsidian-service expects
// (manifest.json, main.js and styles.css side by side). Run after `node esbuild.config.mjs production`.
import console from "console";
import fs from "fs";
import path from "path";

const outDir = ".e2e-plugin";
const files = [
    ["build/main.js", "main.js"],
    ["manifest.json", "manifest.json"],
    ["styles.css", "styles.css"],
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const [from, to] of files) {
    if (!fs.existsSync(from)) {
        throw new Error(
            `${from} not found. Build the plugin first: node esbuild.config.mjs production`,
        );
    }
    fs.copyFileSync(from, path.join(outDir, to));
}
console.log(`Staged ${files.map(([, to]) => to).join(", ")} in ${outDir}/`);
