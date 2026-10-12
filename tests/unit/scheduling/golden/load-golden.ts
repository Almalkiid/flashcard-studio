import { readFileSync } from "fs";
import * as path from "path";
import { gunzipSync } from "zlib";

/** The golden files: outputs captured from the scheduling code before its rewrite (see README.md here). */
export type GoldenName =
    "comments" | "display" | "frontmatter" | "fsrs" | "histogram" | "review-session" | "sm2-grid";

/** Reads one golden file. Values JSON cannot hold are strings starting with "@" (README.md, "Reading the files"). */
export function loadGolden<T = Record<string, unknown>>(name: GoldenName): T {
    const file = path.join(__dirname, `${name}.json.gz`);
    return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as T;
}
