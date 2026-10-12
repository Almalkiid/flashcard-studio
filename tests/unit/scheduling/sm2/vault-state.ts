import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { NoteLinkGraph } from "src/scheduling/sm2/note-graph";
import { setupStaticDateProvider } from "src/utils/clock";

import { mismatches } from "../schedule/golden-views";
import { FakeVault, makeCore, scan } from "./fake-vault";

export type Counts = Record<string, number>;

/** The settings the test vaults were written for: `notes6` marks its clozes with {{curly brackets}}. */
export const vaultSettings = () => ({
    ...DEFAULT_SETTINGS,
    clozePatterns: [...DEFAULT_SETTINGS.clozePatterns, "{{[123;;]answer[;;hint]}}"],
});

export const sorted = (given: Counts): Counts =>
    Object.fromEntries(Object.entries(given).sort((a, b) => Number(a[0]) - Number(b[0])));
export const asCounts = (map: Map<number, number>): Counts =>
    sorted(Object.fromEntries([...map].map(([day, count]) => [String(day), count])));
export const close = (a: number, b: number): boolean =>
    Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
export const ranksClose = (actual: Counts, expected: Counts): boolean =>
    Object.keys(expected).length === Object.keys(actual).length &&
    Object.keys(expected).every((name) => name in actual && close(actual[name], expected[name]));

export const asLines = (
    frontmatter: Record<string, unknown> | undefined,
): Record<string, string> | null =>
    frontmatter === undefined
        ? null
        : Object.fromEntries(
              Object.entries(frontmatter).map(([key, value]) => [
                  key,
                  String(value as string | number),
              ]),
          );

/** What the golden rows record after a scan of a test vault at a clock. */
export async function loadedState(vault: FakeVault, clock: string) {
    setupStaticDateProvider(clock);
    const setup = makeCore(vault, vaultSettings());
    await scan(vault, setup.core);
    const { core, queue } = setup;
    const graph = (core as unknown as { noteLinkGraph: NoteLinkGraph }).noteLinkGraph;
    return { core, queue, graph };
}

export async function mismatchesAsync<R extends { id: string }>(
    rows: R[],
    check: (row: R) => Promise<{ expected: unknown; actual: unknown }>,
) {
    const checked = new Map<string, { expected: unknown; actual: unknown }>();
    for (const row of rows) checked.set(row.id, await check(row));
    return mismatches(rows, (row) => checked.get(row.id));
}
