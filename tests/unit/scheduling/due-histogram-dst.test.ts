/**
 * @jest-environment ./tests/unit/helpers/zone-environment.cjs
 * @jest-environment-options {"tz": "America/New_York"}
 */
import { Card } from "src/data/data-structures/card/flashcard";
import { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import { Deck } from "src/data/decks/deck";
import { NoteReviewDeck, SchedNote } from "src/note-review/note-review-deck";
import {
    CardDueDateHistogram,
    DueDateHistogram,
    NoteDueDateHistogram,
} from "src/scheduling/due-histogram";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { NoteLinkGraph } from "src/scheduling/sm2/note-graph";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { DateUtil, formatDate, globalDateProvider, setupStaticDateProvider } from "src/utils/clock";

import { loadGolden } from "./golden/load-golden";
import { ids, mismatches } from "./schedule/golden-views";
import { RESPONSE, ResponseName, settingsOf } from "./sm2/grid";

// Two days a year the clocks change, and a day is then 23 or 25 hours long. Counting days in milliseconds puts an
// item a day off across that change (D2 #18); counting them on the wall clock does not. These rows ran in New York.

type Counts = Record<string, number>;
interface DstRow {
    id: string;
    clock: string;
    dueDays?: string[];
    histogram?: Counts;
    expectedWholeDayOffsets?: number[];
    response?: ResponseName;
    input?: { dueDay: string; interval: number; ease: number; delayTicks: number };
    out?: { text: string; interval: number; ease: number; dueDay: string };
}
const golden = loadGolden<{
    dst: { timeZone: string; rows: DstRow[] };
    knownBugs: { bug: number; entries: string[] }[];
}>("histogram");
const row = (id: string): DstRow => golden.dst.rows.find((candidate) => candidate.id === id);

const asCounts = (map: Map<number, number>): Counts =>
    Object.fromEntries([...map].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v]));
/** `{0: 1, 1: 1, ...}` for a list of day offsets. */
const countsOf = (offsets: number[]): Counts => {
    const result: Counts = {};
    for (const offset of offsets) result[offset] = (result[offset] ?? 0) + 1;
    return result;
};
const midnight = (day: string): number => DateUtil.dateStrToMoment(day).valueOf();

test("the environment really is New York, with daylight saving", () => {
    expect(golden.dst.timeZone).toBe("America/New_York");
    expect(new Date(2023, 10, 5, 12).getTimezoneOffset()).toBe(300);
    expect(new Date(2023, 6, 15, 12).getTimezoneOffset()).toBe(240);
});

describe("histogram keys across a change of the clocks (D2 #18)", () => {
    // The golden file lists 7 rows under this bug. Five are histograms; two of those (the spring-forward ones) came out
    // right before too, because rounding up absorbs the missing hour, so they must still match. The fall-back ones were
    // wrong: the extra hour pushed every item after the change to the next key.
    const noteRows = [
        "dst/noteHistogram/2023-11-04",
        "dst/noteHistogram/2023-03-11",
        "dst/noteHistogram/2023-09-06",
    ];

    test.each(noteRows)("%s: the notes fall on their whole-day offsets", (id) => {
        const source = row(id);
        setupStaticDateProvider(source.clock);
        const deck = new NoteReviewDeck("#review");
        source.dueDays.forEach((day, index) =>
            deck.scheduledNotes.push(
                new SchedNote({ path: `n${index}.md` } as IVaultNoteFile, midnight(day)),
            ),
        );
        const histogram = new NoteDueDateHistogram();
        histogram.calculateFromReviewDecksAndSort(new Map([["#review", deck]]), {
            pageranks: {},
        } as unknown as NoteLinkGraph);
        expect(asCounts(histogram.dueDatesMap)).toEqual(countsOf(source.expectedWholeDayOffsets));
    });

    test.each(["dst/cardHistogram/2023-11-04", "dst/cardHistogram/2023-03-11"])(
        "%s: the cards fall on their whole-day offsets",
        (id) => {
            const source = row(id);
            setupStaticDateProvider(source.clock);
            const root = new Deck("root", null);
            for (const day of source.dueDays) {
                root.dueReviewItems.push(
                    new Card({ scheduleInfo: Sm2State.fromDueDateStr(day, 1, 250) }),
                );
            }
            const histogram = new CardDueDateHistogram();
            histogram.calculateFromRoot(root);
            // The clock is midnight of the first day, so the offsets are the days from it
            const first = midnight(source.clock);
            const wanted = source.dueDays.map((day) =>
                Math.round(
                    (Date.UTC(...ymd(day)) - Date.UTC(...ymd(formatDate(first)))) / 86_400_000,
                ),
            );
            expect(asCounts(histogram.dueDatesMap)).toEqual(countsOf(wanted));
        },
    );
});

describe("a card two days overdue across the spring change (D2 #18)", () => {
    // Midnight to midnight is 47 hours when a day is 23 hours long. Counted in milliseconds that is one day of delay;
    // the card is two days overdue, so it now gets the bonus of two, the same as the fall-back rows already did.
    const bugRows = new Set(golden.knownBugs.find((bug) => bug.bug === 18).entries);
    const updates = golden.dst.rows.filter((candidate) =>
        candidate.id.startsWith("dst/cardUpdate"),
    );
    function answer(source: DstRow) {
        setupStaticDateProvider(source.clock);
        const schedule = Sm2State.fromDueDateStr(
            source.input.dueDay,
            source.input.interval,
            source.input.ease,
        );
        const answered = new Sm2Scheduler(settingsOf("defaults")).cardCalcUpdatedSchedule(
            RESPONSE[source.response],
            schedule,
            new DueDateHistogram(),
        );
        return {
            delay: schedule.delayedBeforeReviewTicks,
            text: answered.formatScheduleAsComment(),
            interval: answered.interval,
            ease: answered.latestEase,
            dueDay: formatDate(answered.dueDateAsUnix),
        };
    }

    test("the fall-back rows (49 hours, two days) are unchanged", () => {
        const kept = updates.filter((source) => !bugRows.has(source.id));
        const bad = mismatches(kept, (source) => {
            const { delay: _delay, ...actual } = answer(source);
            return { expected: source.out, actual };
        });
        expect(kept).toHaveLength(3);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("the spring-forward rows take the bonus of two whole days, and the delay is exactly two days", () => {
        const changed = updates.filter((source) => bugRows.has(source.id));
        const bad = mismatches(changed, (source) => {
            // The same card two days overdue in the fall-back week, where 49 hours was already two days
            const wanted = row("dst/cardUpdate-positiveDelay/2023-11-06/" + source.response).out;
            const actual = answer(source);
            const due = formatDate(globalDateProvider.today.add(wanted.interval, "d").valueOf());
            return {
                expected: {
                    delay: 2 * 86_400_000,
                    text: `!${due},${wanted.interval},${wanted.ease}`,
                    interval: wanted.interval,
                    ease: wanted.ease,
                    dueDay: due,
                },
                actual,
            };
        });
        expect(changed).toHaveLength(3);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("new cards land on the calendar day after the change (3 rows)", () => {
        const rows = golden.dst.rows.filter((candidate) => candidate.id.startsWith("dst/cardNew"));
        const bad = mismatches(rows, (source) => {
            setupStaticDateProvider(source.clock);
            const schedule = new Sm2Scheduler(settingsOf("defaults")).cardGetNewSchedule(
                RESPONSE[source.response],
                "n.md",
                new DueDateHistogram(),
            );
            return {
                expected: source.out,
                actual: {
                    text: schedule.formatScheduleAsComment(),
                    interval: schedule.interval,
                    ease: schedule.latestEase,
                    dueDay: formatDate(schedule.dueDateAsUnix),
                },
            };
        });
        expect(rows).toHaveLength(3);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });
});

function ymd(day: string): [number, number, number] {
    const [year, month, date] = day.split("-").map(Number);
    return [year, month - 1, date];
}
