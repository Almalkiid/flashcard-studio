import fs from "node:fs";
import path from "node:path";

const directory = "src/settings/definitions";
for (const file of fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".ts"))
    .sort()) {
    const text = fs.readFileSync(path.join(directory, file), "utf8");
    const names = [...text.matchAll(/name:\s*"([^"]+)"/g)].map((match) => match[1]);
    const keys = [...text.matchAll(/key:\s*"([^"]+)"/g)].map((match) => match[1]);
    console.log(`${file}\n  labels: ${names.join(" | ")}\n  keys: ${keys.join(" | ")}`);
}
