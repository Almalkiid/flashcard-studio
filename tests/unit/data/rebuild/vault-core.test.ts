/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- the golden vectors are untyped JSON */
import { Deck, DeckFilter } from "src/data/decks/deck";
import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { ReviewItemState } from "src/scheduling/schedule/review-item";
import { globalDateProvider, setupStaticDateProvider20230906 } from "src/utils/clock";

import { FakeVault, makeCore, scan } from "../../scheduling/sm2/fake-vault";
import { loadGolden } from "./golden";
import { snapshot } from "./tree-helpers";

// The real note file asks Obsidian for the tags of the cache; the fake cache holds them as `tags`. FakeNoteFile (used
// by `scan`) reads them from the text itself, so nothing else is needed here.

const trees = loadGolden("deck-lists.json");
const pipeline = loadGolden("core-pipeline.json");

beforeEach(() => setupStaticDateProvider20230906());

const filesOf = (files: { path: string; text: string }[]) =>
    Object.fromEntries(files.map((file) => [file.path, file.text]));

function setup(files: { path: string; text: string }[], overrides: Partial<StudioSettings>) {
    const settings = { ...cloneDefaultSettings(), ...overrides };
    const vault = new FakeVault(filesOf(files));
    return { vault, settings, ...makeCore(vault, settings) };
}

const counts = (deck: Deck) => ({
    sumNew: deck.getReviewItemCount(ReviewItemState.NewItem, true),
    sumDue: deck.getReviewItemCount(ReviewItemState.DueItem, true),
    distinctNew: deck.getDistinctReviewItemCount(ReviewItemState.NewItem, true),
    distinctDue: deck.getDistinctReviewItemCount(ReviewItemState.DueItem, true),
    distinctAny: deck.getDistinctReviewItemCount(ReviewItemState.AnyItem, true),
});

describe("the deck hierarchies of a scan (deck-lists.json)", () => {
    // The fake vault reads tags with an ASCII-only pattern, so the vector with a deck named éclair cannot run here;
    // the sort order itself is tested on the Deck (deck.test.ts)
    const runnable = trees.vectors.filter((v: { id: string }) => v.id !== "sort-order-of-subdecks");

    test.each(runnable.map((v: { id: string }) => [v.id, v]))("%s", async (_id, vector) => {
        const { vault, core } = setup(vector.files, vector.settings);
        await scan(vault, core);

        const postponed = new Set<string>(vector.postponedFronts);
        for (const deck of core.reviewableRoot.toDeckArray()) {
            for (const card of [...deck.newReviewItems, ...deck.dueReviewItems]) {
                if (postponed.has(card.front)) core.buriedCards.add(card.question);
            }
        }
        await core.refreshQueue();

        expect(snapshot(core.reviewableRoot)).toEqual(vector.reviewableTree);
        expect(counts(core.reviewableRoot)).toEqual(vector.reviewableCounts);
        expect(snapshot(core.remainingRoot)).toEqual(vector.remainingTreeReviewMode);
        expect(counts(core.remainingRoot)).toEqual(vector.remainingCountsReviewMode);
        const cram = DeckFilter.filterForRemainingReviewItems(
            core.buriedCards,
            core.reviewableRoot,
            FlashcardReviewMode.Cram,
        );
        expect(snapshot(cram)).toEqual(vector.remainingTreeCramMode);
    });
});

describe("notes and cards (core-pipeline.json)", () => {
    const vectors = pipeline.vectors.filter((v: { files?: unknown }) => v.files);

    test.each(vectors.map((v: { id: string }) => [v.id, v]))("%s", async (_id, vector) => {
        const { vault, core, queue } = setup(vector.files, vector.settings);
        await scan(vault, core);
        expect(
            [...queue.reviewDecks.values()].map((deck) => ({
                name: deck.deckName,
                newNotes: deck.newNotes.map((note) => note.path),
                scheduled: deck.scheduledNotes.map((note) => note.note.path),
                due: deck.dueNotesCount,
            })),
        ).toEqual(vector.noteReviewDecks);
        expect(queue.dueNotesCount).toBe(vector.dueNotesCount);
        expect(snapshot(core.reviewableRoot)).toMatchObject({
            sub: vector.reviewableTree.sub,
        });
        expect(core.remainingRoot.getDistinctReviewItemCount(ReviewItemState.AnyItem, true)).toBe(
            vector.remainingCounts,
        );
    });

    test("before a scan there are no trees to publish and nothing to tell", async () => {
        const { core } = setup([], {});
        expect(core.remainingRoot).toBeNull();
        expect(core.reviewableRoot.deckName).toBe(pipeline.vectors[3].reviewableTreeName);
        await core.finalizeLoad();
        await core.refreshQueue();
        expect(core.remainingRoot).toBeNull();
    });

    test("starting a scan leaves the published trees alone until it ends", async () => {
        const { vault, core } = setup([{ path: "a.md", text: "#flashcards\nA1::a\n" }], {});
        await scan(vault, core);
        const before = snapshot(core.reviewableRoot);
        expect(before.sub[0].new).toEqual(["A1"]);
        core.loadInitialStateOfCore();
        expect(snapshot(core.reviewableRoot)).toEqual(before);
        await core.finalizeLoad();
        expect(snapshot(core.reviewableRoot).sub).toEqual([]);
    });
});

describe("the start of the study day", () => {
    const start = loadGolden("start-of-day.json");
    const boundaries = start.fromNoBoundary as {
        startOfDay: unknown;
        boundary: unknown;
        warned: number;
    }[];

    test.each(boundaries.map((row) => [JSON.stringify(row.startOfDay), row]))(
        "%s",
        (_text, row) => {
            const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
            globalDateProvider.setDayBoundary(null);
            setup([], { startOfDay: row.startOfDay as string });
            expect(globalDateProvider.getDayBoundary()).toEqual(row.boundary);
            expect(warn.mock.calls.length).toBe(row.warned);
            warn.mockRestore();
        },
    );

    test("an invalid text leaves the boundary that was set before", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        globalDateProvider.setDayBoundary({ hour: 5, minute: 0, second: 0 });
        setup([], { startOfDay: "garbage" });
        expect(globalDateProvider.getDayBoundary()).toEqual({ hour: 5, minute: 0, second: 0 });
        expect(warn).toHaveBeenCalledWith("Invalid format for start of day", "garbage");
        warn.mockRestore();
    });
});
