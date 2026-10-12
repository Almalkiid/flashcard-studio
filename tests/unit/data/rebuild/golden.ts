import { readFileSync } from "fs";
import { join } from "path";

/**
 * Reads a golden vector file of `tests/unit/data/golden` (see the README there). The JSON is not typed: each test
 * reads what it needs, and the files are fixed.
 */
export function loadGolden(name: string) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- untyped JSON
    return JSON.parse(readFileSync(join(__dirname, "..", "golden", name), "utf8"));
}

/** Runs `fn` and returns `{ok}` or `{throws}` in the golden files' own shape. */
export function outcome(fn: () => unknown): { ok: unknown } | { throws: string } {
    try {
        return { ok: fn() };
    } catch (error) {
        return { throws: (error as Error).message };
    }
}
