import { appendFileSync, readFileSync } from "fs";
import * as path from "path";

/**
 * The golden vectors of the note review: what the code before the rewrite produced (see golden/README.md). A rewrite
 * must reproduce every value, except those a listed fix changes. Each such change is declared with the fix behind it,
 * so a difference nobody explained fails the test, and so does an explanation nothing needed.
 */
export const GOLDEN_DIR = path.join(__dirname, "../../note/golden");

export function loadGolden(name: string): unknown {
    return JSON.parse(readFileSync(path.join(GOLDEN_DIR, `${name}.json`), "utf8"));
}

export interface Difference {
    path: string;
    was: unknown;
    now: unknown;
}

/** A change a fix makes. `paths` selects the differing values; `only` can narrow it by their old and new value. */
export interface Change {
    fix: string;
    paths: RegExp;
    only?: (was: unknown, now: unknown, path: string) => boolean;
}

function walk(was: unknown, now: unknown, at: string, out: Difference[]): void {
    if (Array.isArray(was) && Array.isArray(now)) {
        const length = Math.max(was.length, now.length);
        for (let i = 0; i < length; i++) {
            if (i >= was.length) out.push({ path: `${at}[${i}]`, was: undefined, now: now[i] });
            else if (i >= now.length)
                out.push({ path: `${at}[${i}]`, was: was[i], now: undefined });
            else walk(was[i], now[i], `${at}[${i}]`, out);
        }
    } else if (was && now && typeof was === "object" && typeof now === "object") {
        const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
        for (const key of keys) {
            const sub = at ? `${at}.${key}` : key;
            walk(
                (was as Record<string, unknown>)[key],
                (now as Record<string, unknown>)[key],
                sub,
                out,
            );
        }
    } else if (!Object.is(was, now)) {
        out.push({ path: at, was, now });
    }
}

export function differences(was: unknown, now: unknown): Difference[] {
    const out: Difference[] = [];
    walk(was, JSON.parse(JSON.stringify(now ?? null)), "", out);
    return out;
}

function countLeaves(value: unknown): number {
    if (value && typeof value === "object")
        return (Object.values(value) as unknown[]).reduce<number>(
            (sum, v) => sum + countLeaves(v),
            0,
        );
    return 1;
}

/**
 * Compares `actual` with the golden file `name`: every difference must be covered by a change, and every change must
 * have been needed.
 */
export function expectParity(name: string, actual: unknown, changes: Change[] = []): void {
    const found = differences(loadGolden(name), actual);
    // A run for the report sets PARITY_REPORT to a file that collects one line per golden file
    if (process.env.PARITY_REPORT)
        appendFileSync(
            process.env.PARITY_REPORT,
            JSON.stringify({
                name,
                differences: found.length,
                total: countLeaves(loadGolden(name)),
                changed: found,
            }) + "\n",
        );
    const unexplained = found.filter(
        (d) =>
            !changes.some((c) => c.paths.test(d.path) && (c.only?.(d.was, d.now, d.path) ?? true)),
    );
    expect(unexplained).toEqual([]);
    const unused = changes.filter(
        (c) => !found.some((d) => c.paths.test(d.path) && (c.only?.(d.was, d.now, d.path) ?? true)),
    );
    expect(unused.map((c) => c.fix)).toEqual([]);
}
