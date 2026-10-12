import { ReviewItemState, ReviewResponse } from "src/scheduling/schedule/review-item";
import { ActiveScheduler } from "src/scheduling/schedule/scheduler-kind";

import { loadGolden } from "../golden/load-golden";
import { ids } from "../schedule/golden-views";
import { FakeVault } from "./fake-vault";
import {
    asCounts,
    asLines,
    Counts,
    loadedState,
    mismatchesAsync,
    ranksClose,
    sorted,
    vaultSettings,
} from "./vault-state";

interface LoadedRow {
    id: string;
    vault: string;
    clock: string;
    noteHistogram: Counts;
    cardHistogram: Counts;
    noteDueNowCount: number;
    reviewDecks: {
        deck: string;
        dueNotesCount: number;
        newNotes: string[];
        scheduledNotes: [string, string][];
    }[];
    noteEaseList: Record<string, number>;
    pageranks: Record<string, number>;
    reviewableCardCount: number;
    remainingCardCount: number;
}
interface ReviewRow {
    id: string;
    vault: string;
    note: string;
    response: string;
    frontmatterBefore: string | null;
    frontmatterAfter: string;
    noteHistogramAfter: Counts;
    noteDueNowCountAfter: number;
    noteEaseListAfter: Record<string, number>;
}
const golden = loadGolden<{ vaultRuns: (LoadedRow | ReviewRow)[] }>("histogram").vaultRuns;
const loaded = golden.filter((row): row is LoadedRow => row.id.endsWith("/loaded"));
const reviews = golden.filter((row): row is ReviewRow => row.id.includes("/review/"));

const RESPONSE: Record<string, ReviewResponse> = {
    Easy: ReviewResponse.Easy,
    Good: ReviewResponse.Good,
    Hard: ReviewResponse.Hard,
    Again: ReviewResponse.Again,
};

/** The golden text of a frontmatter ("key: value" lines) as an object, so key order does not matter. */
function parseLines(text: string | null): Record<string, string> | null {
    if (text === null) return null;
    return Object.fromEntries(text.split("\n").map((line) => line.split(": ") as [string, string]));
}
/**
 * D2 #3 changes `notes6` (a note with scheduled flashcards and no `sr-*` frontmatter): its ease-list entry is checked in
 * flashcard-only-notes.test.ts, so this file leaves that one number out.
 */
const FLASHCARD_ONLY = new Set(["notes6"]);

describe("a scan of the repo's test vaults, at three dates (24 rows)", () => {
    test("histograms, review decks, page ranks and card counts are those of the golden runs", async () => {
        const bad = await mismatchesAsync(loaded, async (row) => {
            const { core, queue, graph } = await loadedState(
                FakeVault.fromTestVault(row.vault),
                row.clock,
            );
            const easeList = ActiveScheduler.getInstance().noteStats().dict;
            return {
                expected: {
                    noteHistogram: sorted(row.noteHistogram),
                    cardHistogram: sorted(row.cardHistogram),
                    noteDueNowCount: row.noteDueNowCount,
                    reviewDecks: row.reviewDecks,
                    ranks: true,
                    cards: [row.reviewableCardCount, row.remainingCardCount],
                    easeList: FLASHCARD_ONLY.has(row.vault)
                        ? "left to flashcard-only-notes.test.ts"
                        : row.noteEaseList,
                },
                actual: {
                    noteHistogram: asCounts(core.dueDateNoteHistogram.dueDatesMap),
                    cardHistogram: asCounts(core.dueDateFlashcardHistogram.dueDatesMap),
                    noteDueNowCount: core.dueDateNoteHistogram.dueNotesCount,
                    reviewDecks: [...queue.reviewDecks.values()].map((deck) => ({
                        deck: deck.deckName,
                        dueNotesCount: deck.dueNotesCount,
                        newNotes: deck.newNotes.map((file) => file.path),
                        scheduledNotes: deck.scheduledNotes.map((note) => [
                            note.note.path,
                            new Date(note.dueUnix).toISOString().slice(0, 10),
                        ]),
                    })),
                    ranks: ranksClose(graph.pageranks, row.pageranks),
                    cards: [
                        core.reviewableRoot.getDistinctReviewItemCount(
                            ReviewItemState.AnyItem,
                            true,
                        ),
                        core.remainingRoot.getDistinctReviewItemCount(
                            ReviewItemState.AnyItem,
                            true,
                        ),
                    ],
                    easeList: FLASHCARD_ONLY.has(row.vault)
                        ? "left to flashcard-only-notes.test.ts"
                        : easeList,
                },
            };
        });
        expect(loaded).toHaveLength(24);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });
});

describe("reviewing each note of a vault after a fresh scan (60 rows)", () => {
    test("the frontmatter written, the histogram, the due count and the ease list afterwards", async () => {
        const bad = await mismatchesAsync(reviews, async (row) => {
            const vault = FakeVault.fromTestVault(row.vault);
            const { core } = await loadedState(vault, "2023-09-06");
            const file = vault.file(row.note);
            const before = asLines(vault.frontmatter.get(row.note));
            await core.saveNoteReviewResponse(file, RESPONSE[row.response], vaultSettings());
            return {
                expected: {
                    before: parseLines(row.frontmatterBefore),
                    after: parseLines(row.frontmatterAfter),
                    histogram: sorted(row.noteHistogramAfter),
                    due: row.noteDueNowCountAfter,
                    easeList: row.noteEaseListAfter,
                },
                actual: {
                    before:
                        before === null ? null : pick(before, ["sr-due", "sr-interval", "sr-ease"]),
                    after: pick(asLines(vault.frontmatter.get(row.note)), [
                        "sr-due",
                        "sr-interval",
                        "sr-ease",
                    ]),
                    histogram: asCounts(core.dueDateNoteHistogram.dueDatesMap),
                    due: core.dueDateNoteHistogram.dueNotesCount,
                    easeList: ActiveScheduler.getInstance().noteStats().dict,
                },
            };
        });
        expect(reviews).toHaveLength(60);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });
});

function pick(
    source: Record<string, string> | null,
    keys: string[],
): Record<string, string> | null {
    if (source === null) return null;
    return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}
