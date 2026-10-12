import { setupStaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

import { loadGolden } from "../golden/load-golden";
import { ids, mismatches, Slot, sm2Step, view } from "./golden-views";
import { Frontmatter, noteWith, Pairs } from "./note-with";

// moment warns on stderr when it falls back to Date for text that is not ISO; the unreadable inputs below do exactly that
(moment as unknown as { suppressDeprecationWarnings: boolean }).suppressDeprecationWarnings = true;

beforeEach(() => {
    // 2023-09-06 00:00 UTC (the suite runs with TZ=UTC), the clock the golden files were captured with
    setupStaticDateProvider("2023-09-06");
});

interface WriteRow {
    id: string;
    input: {
        dueDay: string;
        interval: number;
        ease: number;
        existingFrontmatter: Frontmatter | null;
    };
    frontmatterAfter: Pairs;
    readBack: Slot;
}

interface ReadRow {
    id: string;
    input: { frontmatter: Frontmatter | "@undefined" };
    result: Slot | null;
}

interface FlowRow {
    id: string;
    input: { frontmatterBefore: Frontmatter | "@undefined"; response: string };
    readSchedule: Slot | null;
    newSchedule: Slot;
    frontmatterAfter: Pairs;
}

const golden = loadGolden<{ writes: WriteRow[]; reads: ReadRow[]; reviewFlows: FlowRow[] }>(
    "frontmatter",
);

/**
 * P3-R2: a due date that is not a date reads as no schedule, like a corrupt card segment. The previous code made a
 * schedule with an invalid date from it, which is never due and so dropped the note out of every queue. The golden rows
 * that did this are `fm-read-null-due`, `fm-read-garbage-date` and `fm-read-boolean-values`.
 *
 * P3-R7: the same for an interval or an ease that is not a number, which made every later answer NaN. The golden rows
 * are `fm-read-null-interval`, `fm-read-garbage-interval`, `fm-read-garbage-ease` (and `fm-read-boolean-values`).
 */
function withoutBrokenDate(slot: Slot | null): Slot | null {
    if (slot === null) return null;
    const unreadable = [slot.dueIso, slot.interval, slot.ease].some(
        (value) => value === "@invalid" || value === "@NaN",
    );
    return unreadable ? null : slot;
}

describe("note frontmatter (sr-due, sr-interval, sr-ease)", () => {
    test("writes the three keys, keeps the others, and reads back what it wrote", async () => {
        const results: { id: string; written: Pairs; readBack: Slot | null }[] = [];
        for (const row of golden.writes) {
            const { note, current } = noteWith(row.input.existingFrontmatter ?? {});
            const { dueDay, interval, ease } = row.input;
            await note.setNoteSchedule(sm2Step(dueDay, interval, ease));
            results.push({
                id: row.id,
                written: current(),
                readBack: view(await note.getNoteSchedule()),
            });
        }
        const byId = new Map(results.map((result) => [result.id, result]));
        const bad = mismatches(golden.writes, (row) => ({
            expected: { written: row.frontmatterAfter, readBack: row.readBack },
            actual: {
                written: byId.get(row.id)?.written,
                readBack: byId.get(row.id)?.readBack,
            },
        }));
        expect(golden.writes).toHaveLength(129);
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("reads every shape of frontmatter the cache can serve", async () => {
        const actual = new Map<string, Slot | null>();
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        for (const row of golden.reads) {
            const { note } = noteWith(
                row.input.frontmatter === "@undefined" ? undefined : row.input.frontmatter,
            );
            actual.set(row.id, view(await note.getNoteSchedule()));
        }
        // One warning for each of the six dropped schedules, saying what was dropped
        expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
            expect.stringContaining('sr-due "null"'),
            expect.stringContaining('sr-interval "null"'),
            expect.stringContaining('sr-due "garbage"'),
            expect.stringContaining('sr-interval "abc"'),
            expect.stringContaining('sr-ease "abc"'),
            expect.stringContaining('sr-due "true"'),
        ]);
        warn.mockRestore();
        const bad = mismatches(golden.reads, (row) => ({
            expected: withoutBrokenDate(row.result),
            actual: actual.get(row.id),
        }));
        expect(golden.reads).toHaveLength(31);
        // The rows the rules change (P3-R2, P3-R7)
        expect(
            golden.reads
                .filter((row) => row.result !== null && withoutBrokenDate(row.result) === null)
                .map((row) => row.id),
        ).toEqual([
            "fm-read-null-due",
            "fm-read-null-interval",
            "fm-read-garbage-date",
            "fm-read-garbage-interval",
            "fm-read-garbage-ease",
            "fm-read-boolean-values",
        ]);
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("a note's delay is today minus the due date, the sign cards now share", async () => {
        const { note } = noteWith({ "sr-due": "2023-09-02", "sr-interval": 4, "sr-ease": 270 });
        const schedule = await note.getNoteSchedule();
        expect(schedule?.delayedBeforeReviewTicks).toBe(4 * 86_400_000);
    });

    test("the schedule of every review flow reads from the note and its next schedule is stored in it", async () => {
        const actual = new Map<string, { read: Slot | null; after: Pairs }>();
        for (const row of golden.reviewFlows) {
            const before = row.input.frontmatterBefore;
            const { note, current } = noteWith(before === "@undefined" ? undefined : before);
            const read = view(await note.getNoteSchedule());
            // the algorithms (SM-2 and FSRS alike) give a note an SM-2 schedule; the flow's next schedule is stored as is
            const next = row.newSchedule;
            await note.setNoteSchedule(
                sm2Step(next.dueDay as string, next.interval as number, next.ease as number),
            );
            actual.set(row.id, { read, after: current() });
        }
        const bad = mismatches(golden.reviewFlows, (row) => ({
            expected: { read: withoutBrokenDate(row.readSchedule), after: row.frontmatterAfter },
            actual: actual.get(row.id),
        }));
        expect(golden.reviewFlows).toHaveLength(48);
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });
});
