import { Card } from "src/data/data-structures/card/flashcard";
import { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import { Deck } from "src/data/decks/deck";
import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { NoteReviewDeck, SchedNote } from "src/note-review/note-review-deck";
import {
    CardDueDateHistogram,
    cardDueDayKey,
    DueDateHistogram,
    NoteDueDateHistogram,
} from "src/scheduling/due-histogram";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewItemState } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { NoteLinkGraph } from "src/scheduling/sm2/note-graph";
import { globalDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

import { clockAt, DEFAULT_CLOCK } from "./fsrs/clock-at";
import { loadGolden } from "./golden/load-golden";
import { ids, mismatches } from "./schedule/golden-views";
import { FakeVault, makeCore, scan } from "./sm2/fake-vault";

type Counts = Record<string, number>;

interface Golden {
    operations: {
        id: string;
        initial: Counts | null | "@undefined";
        steps: { op: [string, ...number[]]; result: unknown; state: Counts }[];
    }[];
    findLeastUsedIntervalOverRange: {
        id: string;
        histogram: Counts;
        original: number;
        fuzz: number;
        out: number;
        histogramUnchanged: boolean;
    }[];
    noteHistogramFromReviewDecks: {
        id: string;
        clock: string;
        input: {
            decks: { name: string; newNotes: string[]; scheduled: [string, number][] }[];
            pageranks: Record<string, number>;
        };
        histogram: Counts;
        afterSort: {
            deck: string;
            newNotes: string[];
            scheduledNotes: [string, number][];
        }[];
    }[];
    cardHistogramFromRoot: {
        id: string;
        clock: string;
        input: { text: string };
        histogram: Counts;
        treeUntouched: boolean;
    }[];
    knownBugs: { bug: number; entries: string[] }[];
}
const golden = loadGolden<Golden>("histogram");

/** A histogram as the plain object the golden files use. */
const counts = (histogram: DueDateHistogram): Counts =>
    Object.fromEntries([...histogram.dueDatesMap].sort((a, b) => a[0] - b[0]));
const sorted = (given: Counts): Counts =>
    Object.fromEntries(Object.entries(given).sort((a, b) => Number(a[0]) - Number(b[0])));

beforeEach(() => {
    clockAt(DEFAULT_CLOCK);
});

describe("DueDateHistogram", () => {
    test("counting days, as the eight golden scripts do it", () => {
        const bad = mismatches(golden.operations, (row) => {
            const histogram = new DueDateHistogram(
                row.initial === "@undefined" || row.initial === null ? undefined : row.initial,
            );
            const trace = row.steps.map((step) => {
                const [op, ...args] = step.op;
                let result: unknown = null;
                if (op === "increment") histogram.increment(args[0]);
                else if (op === "decrement") histogram.decrement(args[0]);
                else if (op === "get") result = histogram.get(args[0]) ?? "@undefined";
                else if (op === "has") result = histogram.hasEntryForDays(args[0]);
                else if (op === "set") histogram.dueDatesMap.set(args[0], args[1]);
                else if (op === "dueNotesCount") result = histogram.dueNotesCount;
                return [result, counts(histogram)];
            });
            return {
                expected: row.steps.map((step) => [step.result, sorted(step.state)]),
                actual: trace,
            };
        });
        expect(golden.operations).toHaveLength(8);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("the search for the least used day (410 rows); the two zero-count rows of oddity 15 behave as before", () => {
        const bad = mismatches(golden.findLeastUsedIntervalOverRange, (row) => {
            const histogram = new DueDateHistogram(row.histogram);
            const before = counts(histogram);
            const found = histogram.findLeastUsedIntervalOverRange(row.original, row.fuzz);
            return {
                expected: [row.out, row.histogramUnchanged],
                actual: [found, JSON.stringify(counts(histogram)) === JSON.stringify(before)],
            };
        });
        expect(golden.findLeastUsedIntervalOverRange).toHaveLength(410);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
        // D2 does not list #15, so these two keep the old answer
        expect(golden.knownBugs.find((bug) => bug.bug === 15).entries).toHaveLength(2);
    });
});

describe("NoteDueDateHistogram", () => {
    const fileOf = (path: string): IVaultNoteFile => ({ path }) as IVaultNoteFile;

    test("counts the days to each due note and sorts the decks (6 rows)", () => {
        const bad = mismatches(golden.noteHistogramFromReviewDecks, (row) => {
            clockAt(row.clock);
            const decks = new Map<string, NoteReviewDeck>();
            for (const input of row.input.decks) {
                const deck = new NoteReviewDeck(input.name);
                deck.newNotes.push(...input.newNotes.map(fileOf));
                deck.scheduledNotes.push(
                    ...input.scheduled.map(([path, due]) => new SchedNote(fileOf(path), due)),
                );
                decks.set(input.name, deck);
            }
            const histogram = new NoteDueDateHistogram();
            histogram.calculateFromReviewDecksAndSort(decks, {
                pageranks: row.input.pageranks,
            } as unknown as NoteLinkGraph);
            return {
                expected: [sorted(row.histogram), row.afterSort],
                actual: [
                    counts(histogram),
                    [...decks.values()].map((deck) => ({
                        deck: deck.deckName,
                        newNotes: deck.newNotes.map((file) => file.path),
                        scheduledNotes: deck.scheduledNotes.map((note) => [
                            note.note.path,
                            note.dueUnix,
                        ]),
                    })),
                ],
            };
        });
        expect(golden.noteHistogramFromReviewDecks).toHaveLength(6);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("calculating again starts from nothing", () => {
        const deck = new NoteReviewDeck("#review");
        deck.scheduledNotes.push(new SchedNote(fileOf("a.md"), Date.UTC(2023, 8, 9)));
        const histogram = new NoteDueDateHistogram();
        const graph = { pageranks: {} } as unknown as NoteLinkGraph;
        histogram.calculateFromReviewDecksAndSort(new Map([["#review", deck]]), graph);
        histogram.calculateFromReviewDecksAndSort(new Map([["#review", deck]]), graph);
        expect(counts(histogram)).toEqual({ 3: 1 });
    });
});

describe("CardDueDateHistogram", () => {
    test("counts the days to each scheduled card of a deck hierarchy (7 rows), and leaves the tree alone", async () => {
        const results: { id: string; histogram: Counts; untouched: boolean }[] = [];
        for (const row of golden.cardHistogramFromRoot) {
            clockAt(row.clock);
            const vault = new FakeVault({ "n.md": row.input.text });
            const { core } = makeCore(vault, { ...DEFAULT_SETTINGS });
            await scan(vault, core);
            const tree = core.reviewableRoot;
            const cardsBefore = tree.getDistinctReviewItemCount(ReviewItemState.AnyItem, true);
            const histogram = new CardDueDateHistogram();
            histogram.calculateFromRoot(tree);
            results.push({
                id: row.id,
                histogram: counts(histogram),
                untouched:
                    tree.getDistinctReviewItemCount(ReviewItemState.AnyItem, true) ===
                        cardsBefore &&
                    JSON.stringify(counts(core.dueDateFlashcardHistogram)) ===
                        JSON.stringify(counts(histogram)),
            });
        }
        const byId = new Map(results.map((result) => [result.id, result]));
        const bad = mismatches(golden.cardHistogramFromRoot, (row) => ({
            expected: [sorted(row.histogram), row.treeUntouched],
            actual: [byId.get(row.id).histogram, byId.get(row.id).untouched],
        }));
        expect(golden.cardHistogramFromRoot).toHaveLength(7);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("a card in two decks counts once, and cards without a schedule not at all", () => {
        const card = new Card({
            scheduleInfo: Sm2State.fromDueDateStr("2023-09-09", 4, 250),
        });
        const root = new Deck("root", null);
        const a = new Deck("a", root);
        const b = new Deck("b", root);
        root.subdecks.push(a, b);
        a.dueReviewItems.push(card);
        b.dueReviewItems.push(card);
        a.newReviewItems.push(new Card());
        const histogram = new CardDueDateHistogram();
        histogram.calculateFromRoot(root);
        expect(counts(histogram)).toEqual({ 3: 1 });
    });
});

describe("keys by study day (D2 #17): a day that starts at 04:00", () => {
    // 02:00 on 7 September is still the study day of 6 September when the day starts at 04:00
    const at = "2023-09-07T02:00:00.000Z";
    const day = (date: string) => Sm2State.fromDueDateStr(date, 1, 250);
    const instant = (iso: string) => new FsrsState(moment(iso), 0, 5.5, 0.4, 1, 1, 0, 1, null);

    function treeOf(...schedules: ScheduleState[]): Deck {
        const root = new Deck("root", null);
        for (const scheduleInfo of schedules) root.dueReviewItems.push(new Card({ scheduleInfo }));
        return root;
    }

    test("an SM-2 card due on the next calendar date is due tomorrow, as a note is", () => {
        clockAt(at);
        globalDateProvider.setDayBoundary({ hour: 4, minute: 0, second: 0 });
        const cards = new CardDueDateHistogram();
        cards.calculateFromRoot(treeOf(day("2023-09-06"), day("2023-09-07"), day("2023-09-09")));
        expect(counts(cards)).toEqual({ 0: 1, 1: 1, 3: 1 });

        const deck = new NoteReviewDeck("#review");
        for (const date of ["2023-09-06", "2023-09-07", "2023-09-09"]) {
            deck.scheduledNotes.push(
                new SchedNote({ path: `${date}.md` } as IVaultNoteFile, day(date).dueDateAsUnix),
            );
        }
        const notes = new NoteDueDateHistogram();
        notes.calculateFromReviewDecksAndSort(new Map([["#review", deck]]), {
            pageranks: {},
        } as unknown as NoteLinkGraph);
        expect(counts(notes)).toEqual(counts(cards));
    });

    test("without a day boundary the same instant is already 7 September", () => {
        clockAt(at);
        globalDateProvider.setDayBoundary(null);
        const cards = new CardDueDateHistogram();
        cards.calculateFromRoot(treeOf(day("2023-09-06"), day("2023-09-07"), day("2023-09-09")));
        expect(counts(cards)).toEqual({ "-1": 1, 0: 1, 2: 1 });
    });

    test("an FSRS card is counted from now, not from the start of the study day", () => {
        clockAt(at);
        globalDateProvider.setDayBoundary({ hour: 4, minute: 0, second: 0 });
        const cards = new CardDueDateHistogram();
        cards.calculateFromRoot(
            treeOf(
                instant("2023-09-07T01:00:00.000Z"),
                instant("2023-09-07T03:00:00.000Z"),
                instant("2023-09-08T03:00:00.000Z"),
            ),
        );
        expect(counts(cards)).toEqual({ 0: 1, 1: 1, 2: 1 });
    });

    test("the key the review session asks for is the key the histogram counts", () => {
        clockAt(at);
        globalDateProvider.setDayBoundary({ hour: 4, minute: 0, second: 0 });
        expect(cardDueDayKey(day("2023-09-07"))).toBe(1);
        expect(cardDueDayKey(instant("2023-09-07T03:00:00.000Z"))).toBe(1);
        expect(cardDueDayKey(instant("2023-09-07T01:00:00.000Z"))).toBe(0);
    });
});
