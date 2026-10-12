import { CardMeta, formatMetaTokens, parseCommentMeta } from "src/data/card-meta";
import { Sm2NoteStore } from "src/data/data-store/notes/comment-algorithm";
import { NotesDataStore } from "src/data/data-store/notes/notes-store";
import { Card } from "src/data/data-structures/card/flashcard";
import { Question } from "src/data/data-structures/card/question";
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import {
    formatFsrsTimestamp,
    FSRS_COMMENT_PREFIX,
    FSRS_EMPTY_SCHEDULE_COMMENT,
    parseFsrsTimestamp,
} from "src/scheduling/schedule/fsrs-state";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { setupStaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

import { loadGolden } from "../golden/load-golden";
import { FsrsInput, fsrsSchedule, ids, mismatches, Slot, sm2Step, view } from "./golden-views";

// moment warns on stderr when it falls back to Date for text that is not ISO; the unreadable inputs below do exactly that
(moment as unknown as { suppressDeprecationWarnings: boolean }).suppressDeprecationWarnings = true;

// The reader warns about every segment it drops; the odd inputs below have many, so the warnings are caught here
let warn: jest.SpyInstance<void, unknown[]>;

beforeEach(() => {
    // 2023-09-06 00:00 UTC (the suite runs with TZ=UTC), the clock the golden files were captured with
    setupStaticDateProvider("2023-09-06");
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    warn.mockRestore();
});

// #region -> The golden file and its row shapes

interface ReadResult {
    slots: (Slot | null)[];
    meta: CardMeta[];
}

interface Row {
    id: string;
    written?: string;
    roundTripWithoutMeta?: string;
    idGenerated?: boolean;
    read: ReadResult;
}

interface Sm2Row extends Row {
    input: { dueDay: string; interval: number; ease: number; meta: CardMeta };
}

interface FsrsRow extends Row {
    input: FsrsInput & { meta: CardMeta };
}

interface EdgeRow extends Row {
    input: { algorithm: SchedulerKind; dueDay?: string; interval: number; ease?: number } & {
        stability?: number;
        difficulty?: number;
    };
}

interface PlaceholderRow extends Row {
    input: { algorithmSetting: SchedulerKind; baseEase: number; meta: CardMeta };
    constants?: Record<string, unknown>;
}

type SlotInput =
    | { kind: "none"; meta: CardMeta }
    | { kind: "sm2"; dueDay: string; interval: number; ease: number; meta: CardMeta }
    | ({ kind: "fsrs"; meta: CardMeta } & FsrsInput);

interface MultiRow extends Row {
    input: { algorithmSetting: SchedulerKind; baseEase: number; slots: SlotInput[] };
}

interface OddRow extends Row {
    input: { questionText: string };
}

interface TimestampRow {
    id: string;
    fn: "parseFsrsTimestamp" | "formatFsrsTimestamp";
    input: string | null;
    out: unknown;
}

const golden = loadGolden<{
    sm2Random: Sm2Row[];
    fsrsRandom: FsrsRow[];
    edgeNumbers: EdgeRow[];
    placeholders: PlaceholderRow[];
    multiSegmentComments: MultiRow[];
    legacyAndOddInputs: OddRow[];
    timestampHelpers: TimestampRow[];
    knownBugs: { bug: number | null; entries: string[]; fixedValues?: unknown[] }[];
}>("comments");

/** The placeholder rows for one card each; `ph-constants` lists the stored constants instead. */
const placeholderRows = (): PlaceholderRow[] => golden.placeholders.filter((row) => !row.constants);

const bugEntries = (bug: number): string[] =>
    golden.knownBugs.find((known) => known.bug === bug)?.entries ?? [];

// #endregion

// #region -> The fixes the new reader makes (decisions D2 #1, #5, #6), applied to the golden rows

const DAY = 86_400_000;

/** The text of the question a row reads: one comment around a written segment, or the question itself. */
function questionText(row: Row): string {
    const written = row.written ?? "";
    return `Q::A\n${written.startsWith("<!--SR:") ? written : `<!--SR:${written}-->`}`;
}

/** The comma-separated fields of each segment of the first schedule comment, the way the reader splits it. */
function segmentFields(text: string): string[][] | null {
    const body = text.match(/<!--SR:(.+?)-->/m)?.[1];
    if (!body) return null;
    return body
        .split("!")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .map((segment) => segment.split(","));
}

const NUMBER_FIELDS = [
    "interval",
    "ease",
    "difficulty",
    "stability",
    "state",
    "reps",
    "lapses",
    "learningSteps",
];

/** Text that is not a schedule: no date, or a number or state that is not one. The old reader made up an object. */
function wasUnreadable(slot: Slot): boolean {
    return (
        slot.dueIso === "@invalid" ||
        NUMBER_FIELDS.some((field) => slot[field] === "@NaN") ||
        (slot.algorithm === SchedulerKind.FSRS && ![0, 1, 2, 3].includes(slot.state as number))
    );
}

/**
 * What the new reader gives where the old one gave `row.read.slots`:
 *  - #5: unreadable text is no schedule (null); an unreadable last review is dropped, the card is kept;
 *  - #6: an SM-2 interval is read as written (`10.8` stays 10.8);
 *  - #1: an SM-2 delay is the start of today minus the due date, so it is positive for an overdue card.
 */
function fixedSlots(row: Row, text: string): (Slot | null)[] {
    const segments = segmentFields(text);
    return row.read.slots.map((slot, index) => {
        if (slot === null) return null;
        if (wasUnreadable(slot)) return null;
        if (slot.algorithm === SchedulerKind.FSRS) {
            if (slot.lastReviewIso !== "@invalid") return slot;
            const kept: Slot = { ...slot, lastReviewIso: null };
            return { ...kept, text: fsrsText(kept) };
        }
        const token = segments?.[index]?.[1];
        const interval = token === undefined ? (slot.interval as number) : parseFloat(token);
        return {
            ...slot,
            interval,
            delayTicks: 0 - (slot.delayTicks as number),
            text: `!${slot.dueDay as string},${interval},${slot.ease as number}`,
        };
    });
}

/** The comment text of an FSRS slot view, in the stored field order. */
function fsrsText(slot: Slot): string {
    const last = slot.lastReviewIso === null ? "-" : (slot.lastReviewIso as string);
    return `!fsrs,${slot.dueIso as string},${slot.interval as number},${slot.stability as number},${slot.difficulty as number},${slot.state as number},${slot.reps as number},${slot.lapses as number},${slot.learningSteps as number},${last}`;
}

// #endregion

// #region -> Reading comments

const store = new NotesDataStore({ ...DEFAULT_SETTINGS }, null);
const read = (text: string): (Slot | null)[] => store.createSchedule(text, null).map(view);

const COMMENT_ROWS = (): Row[] => [
    ...golden.sm2Random,
    ...golden.fsrsRandom,
    ...golden.edgeNumbers,
    ...placeholderRows().filter((row) => !row.idGenerated),
    ...golden.multiSegmentComments,
];

describe("reading comments", () => {
    test("every written comment reads back as the golden file says, with the fixes of D2 #1, #5 and #6", () => {
        expect(COMMENT_ROWS()).toHaveLength(872);
        const bad = mismatches(COMMENT_ROWS(), (row) => ({
            expected: fixedSlots(row, questionText(row)),
            actual: read(questionText(row)),
        }));
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("the metadata tail of every written comment reads back", () => {
        const bad = mismatches(COMMENT_ROWS(), (row) => ({
            expected: row.read.meta,
            actual: parseCommentMeta(questionText(row)),
        }));
        expect(ids(bad)).toEqual([]);
    });

    test("legacy and odd shapes read back as the golden file says, with the same fixes", () => {
        expect(golden.legacyAndOddInputs).toHaveLength(57);
        const bad = mismatches(golden.legacyAndOddInputs, (row) => ({
            expected: fixedSlots(row, row.input.questionText),
            actual: read(row.input.questionText),
        }));
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("an SM-2 card reads its fractional interval as written (D2 #6)", () => {
        const rows = golden.sm2Random.filter((row) => !Number.isInteger(row.input.interval));
        expect(rows.length).toBeGreaterThanOrEqual(25);
        for (const row of rows) {
            expect(read(questionText(row))[0]?.interval).toBe(row.input.interval);
        }
        // every row the golden file lists under bug 6 is one of the fractional rows
        const listed = bugEntries(6).filter((id) => id.startsWith("sm2-"));
        expect(listed.every((id) => rows.some((row) => row.id === id))).toBe(true);
    });

    test("an overdue SM-2 card has a positive delay, one not yet due a negative one (D2 #1)", () => {
        const [overdue, today, early] = read(
            "<!--SR:!2023-09-02,4,270!2023-09-06,4,270!2023-09-10,4,270-->",
        );
        expect([overdue?.delayTicks, today?.delayTicks, early?.delayTicks]).toEqual([
            4 * DAY,
            0,
            -4 * DAY,
        ]);
    });

    test("the fixed delay is the golden value with its sign flipped, as the golden file lists for bug 1", () => {
        const listed = golden.knownBugs.find((known) => known.bug === 1)?.fixedValues as {
            entry: string;
            value: number;
        }[];
        expect(listed).toHaveLength(330);
        const byId = new Map(golden.sm2Random.map((row) => [row.id, row]));
        const bad = listed.filter(
            ({ entry, value }) =>
                read(questionText(byId.get(entry) as Row))[0]?.delayTicks !== value,
        );
        expect(bad.map((entry) => entry.entry)).toEqual([]);
    });

    test("of the rows the golden file lists under bug 5, only numbers in odd notation and an unreadable last review still make a schedule", () => {
        const rows = new Map(golden.legacyAndOddInputs.map((row) => [row.id, row]));
        const stillSchedules = bugEntries(5).filter((id) => {
            const [slot] = read(rows.get(id).input.questionText);
            return slot !== null && slot !== undefined;
        });
        expect(stillSchedules.sort()).toEqual([
            "odd-exponent-numbers",
            "odd-fsrs-garbage-last-review",
            "odd-huge-interval",
            "odd-negative-interval",
            "odd-zero-ease",
        ]);
    });

    test("an unreadable last review is dropped and the card is kept", () => {
        const slot = read("<!--SR:!fsrs,2023-09-06T00:10:00.000Z,0,0.4,5.5,1,1,0,1,garbage-->")[0];
        expect(slot).toMatchObject({ lastReviewIso: null, state: 1 });
        expect(slot?.text).toBe("!fsrs,2023-09-06T00:10:00.000Z,0,0.4,5.5,1,1,0,1,-");
    });

    test("nine FSRS fields are a whole schedule; the last review is the tenth and optional (D6)", () => {
        const slot = read("<!--SR:!fsrs,2023-09-06T00:10:00.000Z,0,0.4,5.5,1,1,0,1-->")[0];
        expect(slot).toMatchObject({ learningSteps: 1, lastReviewIso: null });
        expect(read("<!--SR:!fsrs,2023-09-06T00:10:00.000Z,0,0.4,5.5,1,1,0-->")).toEqual([null]);
    });

    test("a segment that cannot be read is dropped with one warning in the console", () => {
        expect(read("<!--SR:!garbage,4,270!2023-09-10,4,270-->").map((s) => s === null)).toEqual([
            true,
            false,
        ]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0] as string).toContain("garbage,4,270");
    });

    test("an SM-2 segment with numbers that are not numbers is reported as it was written", () => {
        expect(read("<!--SR:!2023-09-02,x,y-->")).toEqual([null]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0] as string).toContain('"2023-09-02,x,y"');
    });

    test("an FSRS segment that cannot be read is reported with its text", () => {
        expect(read("<!--SR:!fsrs,2023-09-06T00:10:00.000Z,0,0.4-->")).toEqual([null]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0] as string).toContain("fsrs,2023-09-06T00:10:00.000Z,0,0.4");
    });

    test("a card never reviewed (a placeholder) is no schedule and gives no warning", () => {
        expect(read("<!--SR:!2000-01-01,1,250!fsrs,-,0,0,0,0,0,0,0,--->")).toEqual([null, null]);
        expect(warn).not.toHaveBeenCalled();
    });
});

// #endregion

// #region -> Writing comments

function fsrsInput(row: FsrsRow | EdgeRow): FsrsInput {
    if ("dueIso" in row.input) return row.input;
    // the edge rows only list the numbers they vary; the rest is the same card in every row
    return {
        dueIso: "2023-09-06T00:10:00.000Z",
        interval: row.input.interval,
        difficulty: row.input.difficulty,
        stability: row.input.stability,
        state: 2,
        reps: 1,
        lapses: 0,
        learningSteps: 0,
        lastReviewIso: "2023-09-06T00:00:00.000Z",
    };
}

const EDGE_META: CardMeta = {
    id: "abcdef",
    suspended: false,
    buryUntil: null,
    flag: 0,
    leech: false,
    extras: [],
};

function scheduleOf(slot: SlotInput): ScheduleState | null {
    if (slot.kind === "none") return null;
    return slot.kind === "sm2"
        ? sm2Step(slot.dueDay, slot.interval, slot.ease)
        : fsrsSchedule(slot);
}

function formatCard(settings: StudioSettings, schedule: ScheduleState | null, meta: CardMeta) {
    const card = new Card({ scheduleInfo: schedule, meta: { ...meta, extras: [...meta.extras] } });
    return new Sm2NoteStore(settings).formatCardSchedule(card);
}

describe("writing comments", () => {
    test("SM-2 schedules with their metadata tail", () => {
        const rows: (Sm2Row | EdgeRow)[] = [
            ...golden.sm2Random,
            ...golden.edgeNumbers.filter((row) => row.input.algorithm === SchedulerKind.SM2),
        ];
        const bad = mismatches(rows, (row) => {
            const input = row.input as Sm2Row["input"];
            const meta = "meta" in row.input ? input.meta : EDGE_META;
            return {
                expected: row.written,
                actual: formatCard(
                    DEFAULT_SETTINGS,
                    sm2Step(input.dueDay, input.interval, input.ease),
                    meta,
                ),
            };
        });
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("FSRS schedules with their metadata tail", () => {
        const rows: (FsrsRow | EdgeRow)[] = [
            ...golden.fsrsRandom,
            ...golden.edgeNumbers.filter((row) => row.input.algorithm === SchedulerKind.FSRS),
        ];
        const bad = mismatches(rows, (row) => ({
            expected: row.written,
            actual: formatCard(
                DEFAULT_SETTINGS,
                fsrsSchedule(fsrsInput(row)),
                "meta" in row.input ? row.input.meta : EDGE_META,
            ),
        }));
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("an SM-2 schedule without its metadata reads back as the same text with the interval kept", () => {
        const bad = mismatches(golden.sm2Random, (row) => ({
            expected: `!${row.input.dueDay},${row.input.interval},${row.read.slots[0]?.ease as number}`,
            actual: sm2Step(
                row.input.dueDay,
                row.input.interval,
                row.input.ease,
            ).formatScheduleAsComment(),
        }));
        expect(ids(bad)).toEqual([]);
        // the golden round trip differs only where the old reader cut the interval (D2 #6)
        const cut = golden.sm2Random.filter(
            (row) => row.roundTripWithoutMeta !== read(questionText(row))[0]?.text,
        );
        expect(cut.map((row) => row.id)).toEqual(
            golden.sm2Random
                .filter((row) => !Number.isInteger(row.input.interval))
                .map((row) => row.id),
        );
    });

    test("placeholders for cards never reviewed, in the format of the algorithm setting", () => {
        const bad = mismatches(placeholderRows(), (row) => {
            const { algorithmSetting, baseEase, meta } = row.input;
            const written = formatCard(
                { ...DEFAULT_SETTINGS, algorithm: algorithmSetting, baseEase },
                null,
                meta,
            );
            // a card with metadata to keep gets a fresh random id
            return {
                expected: row.written,
                actual: row.idGenerated
                    ? written.replace(/id=[0-9a-z]{6}/, "id=<generated-id>")
                    : written,
            };
        });
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("comments of several cards, scheduled and not, with metadata", () => {
        const bad = mismatches(golden.multiSegmentComments, (row) => {
            const { algorithmSetting, baseEase, slots } = row.input;
            const settings = { ...DEFAULT_SETTINGS, algorithm: algorithmSetting, baseEase };
            const cards = slots.map(
                (slot) =>
                    new Card({
                        scheduleInfo: scheduleOf(slot),
                        meta: { ...slot.meta, extras: [...slot.meta.extras] },
                    }),
            );
            return {
                expected: row.written,
                actual: new Sm2NoteStore(settings).questionFormatScheduleAsHtmlComment({
                    cards,
                } as unknown as Question),
            };
        });
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("the stored constants are the ones the golden file lists", () => {
        const listed = golden.placeholders.find((row) => row.constants)?.constants;
        expect(listed).toEqual({
            FSRS_COMMENT_PREFIX,
            FSRS_EMPTY_SCHEDULE_COMMENT,
            dummyDueDateForNewCard: Sm2State.dummyDueDateForNewCard,
            initialInterval: Sm2State.initialInterval,
        });
    });

    test("the metadata tail formats as written", () => {
        const tail = formatMetaTokens({
            ...EDGE_META,
            suspended: true,
            buryUntil: "2023-09-08",
            flag: 3,
            leech: true,
            extras: ["x=2"],
        });
        expect(tail).toBe(",id=abcdef,susp,bury=2023-09-08,flag=3,leech,x=2");
    });
});

// #endregion

// #region -> The FSRS timestamp helpers

describe("FSRS timestamps", () => {
    test("every golden row", () => {
        const bad = mismatches(golden.timestampHelpers, (row) => {
            if (row.fn === "formatFsrsTimestamp") {
                const input = row.input;
                try {
                    return {
                        expected: row.out,
                        actual: formatFsrsTimestamp(input === null ? null : moment(input)),
                    };
                } catch (error) {
                    return { expected: row.out, actual: `@throws: ${(error as Error).message}` };
                }
            }
            const parsed = parseFsrsTimestamp(row.input === "@undefined" ? undefined : row.input);
            const out = row.out as { iso: string; valid: boolean } | null;
            if (parsed === null || out === null) return { expected: out, actual: parsed };
            const wallClock = out.iso === "@wall-clock-now";
            const iso = parsed.isValid() ? parsed.toDate().toISOString() : "@invalid";
            return {
                expected: { ...out, iso: wallClock ? "@wall-clock-now" : out.iso },
                actual: {
                    valid: parsed.isValid(),
                    iso:
                        wallClock && Math.abs(parsed.valueOf() - Date.now()) < 5000
                            ? "@wall-clock-now"
                            : iso,
                },
            };
        });
        expect(ids(bad)).toEqual([]);
    });

    test("a dash is no time, in both directions", () => {
        expect(parseFsrsTimestamp("-")).toBeNull();
        expect(formatFsrsTimestamp(null)).toBe("-");
    });
});

// #endregion
