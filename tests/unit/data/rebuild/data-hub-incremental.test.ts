import { TopicPath } from "src/data/decks/topic-path";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { ReviewItemState } from "src/scheduling/schedule/review-item";
import { setupStaticDateProvider20230906 } from "src/utils/clock";

import { FakePlugin } from "./fake-plugin";

jest.mock("obsidian", () => ({
    ...jest.requireActual<Record<string, unknown>>("../../support/obsidian"),
    getAllTags: (cache: { tags?: { tag: string }[] }) => [
        ...new Set((cache.tags ?? []).map((entry) => entry.tag)),
    ],
}));

const NOTES = {
    "a.md": "#flashcards\nA1::a1\nA2::a2 <!--SR:!2023-09-02,4,270-->\n",
    "b.md": "#flashcards/sub\nB1::b1\n",
    "n.md": "#review\na note\n",
};

beforeEach(() => setupStaticDateProvider20230906());

async function started(files: Record<string, string> = NOTES) {
    const fake = new FakePlugin(files);
    const changed = jest.fn(() => Promise.resolve());
    const { manager } = await fake.startManager(changed);
    const core = manager.vaultIndex;
    const processFile = jest.spyOn(core, "processFile");
    return { fake, manager, core, processFile, changed };
}

const fronts = (manager: {
    vaultIndex: {
        reviewableRoot: {
            getFlattenedReviewItemArray: (s: ReviewItemState, d: boolean) => { front: string }[];
        };
    };
}) =>
    manager.vaultIndex.reviewableRoot
        .getFlattenedReviewItemArray(ReviewItemState.AnyItem, true)
        .map((card) => card.front)
        .sort();

describe("sync reads the notes only when something changed", () => {
    test("the first sync reads every note, the next one with nothing changed reads none but still tells the plugin", async () => {
        const { manager, processFile, changed } = await started();
        await manager.sync();
        expect(processFile).toHaveBeenCalledTimes(3);
        const callsAfterFirst = changed.mock.calls.length;
        await manager.sync();
        expect(processFile).toHaveBeenCalledTimes(3);
        expect(changed.mock.calls.length).toBe(callsAfterFirst + 1);
        expect(fronts(manager)).toEqual(["A1", "A2", "B1"]);
        expect(manager.vaultIndex.noteReviewQueue.reviewDecks.get("#review").newNotes).toHaveLength(
            1,
        );
    });

    test("an edited note is read again, and only a scan shows its new cards", async () => {
        const { fake, manager, processFile } = await started();
        await manager.sync();
        fake.edit("b.md", "#flashcards/sub\nB1::b1\nB2::b2\n");
        await manager.sync();
        expect(processFile).toHaveBeenCalledTimes(6);
        expect(fronts(manager)).toEqual(["A1", "A2", "B1", "B2"]);
    });

    test("a note that was added or taken out is seen", async () => {
        const { fake, manager, processFile } = await started();
        await manager.sync();
        fake.add("c.md", "#flashcards\nC1::c1\n");
        await manager.sync();
        expect(fronts(manager)).toEqual(["A1", "A2", "B1", "C1"]);
        fake.remove("a.md");
        await manager.sync();
        expect(fronts(manager)).toEqual(["B1", "C1"]);
        expect(processFile.mock.calls.length).toBeGreaterThan(3);
    });

    test("a changed setting makes the next sync read the notes again", async () => {
        const { fake, manager, processFile } = await started();
        await manager.sync();
        fake.settings.flashcardTags = ["#flashcards/sub"];
        await manager.sync();
        expect(processFile).toHaveBeenCalledTimes(6);
        expect(fronts(manager)).toEqual(["B1"]);
    });

    test("a change of the metadata cache makes the next sync read the notes again", async () => {
        const { fake, manager, processFile } = await started();
        await manager.sync();
        fake.emit("changed");
        await manager.sync();
        expect(processFile).toHaveBeenCalledTimes(6);
        await manager.sync();
        expect(processFile).toHaveBeenCalledTimes(6);
        expect(fake.registered).toHaveLength(1);
    });

    test("a note that tells no change time is always read again", async () => {
        const { fake, manager, processFile } = await started();
        delete (fake.files[0] as { stat?: unknown }).stat;
        await manager.sync();
        await manager.sync();
        expect(processFile).toHaveBeenCalledTimes(6);
    });

    test("a failed scan is not remembered as done", async () => {
        const { manager, processFile } = await started();
        processFile.mockRejectedValueOnce(new Error("boom"));
        await expect(manager.sync()).rejects.toThrow("boom");
        await manager.sync();
        expect(fronts(manager)).toEqual(["A1", "A2", "B1"]);
    });
});

describe("a review session uses its own copy of the trees", () => {
    const drain = (
        manager: Awaited<ReturnType<typeof started>>["manager"],
        mode: FlashcardReviewMode,
    ) => {
        const tree = manager.vaultIndex.sessionTree(mode);
        const all = tree.getFlattenedReviewItemArray(ReviewItemState.AnyItem, true);
        for (const deck of tree.toDeckArray()) {
            deck.newReviewItems.length = 0;
            deck.dueReviewItems.length = 0;
        }
        return all.length;
    };

    test("using a session's cards up leaves the next session, and the counts, whole - with no new scan", async () => {
        const { manager, processFile } = await started();
        await manager.sync();
        const core = manager.vaultIndex;
        const reviewable = core.reviewableRoot.getDistinctReviewItemCount(
            ReviewItemState.AnyItem,
            true,
        );
        const remaining = core.remainingRoot.getDistinctReviewItemCount(
            ReviewItemState.AnyItem,
            true,
        );

        expect(drain(manager, FlashcardReviewMode.Review)).toBe(remaining);
        expect(drain(manager, FlashcardReviewMode.Cram)).toBe(reviewable);

        await manager.sync();
        expect(processFile).toHaveBeenCalledTimes(3);
        expect(core.reviewableRoot.getDistinctReviewItemCount(ReviewItemState.AnyItem, true)).toBe(
            reviewable,
        );
        expect(core.remainingRoot.getDistinctReviewItemCount(ReviewItemState.AnyItem, true)).toBe(
            remaining,
        );
        expect(
            core
                .sessionTree(FlashcardReviewMode.Review)
                .getDistinctReviewItemCount(ReviewItemState.AnyItem, true),
        ).toBe(remaining);
    });

    test("a review session's tree holds the same card objects as the scan", async () => {
        const { manager } = await started();
        await manager.sync();
        const core = manager.vaultIndex;
        const session = core.sessionTree(FlashcardReviewMode.Review);
        const sub = session.getDeck(TopicPath.getTopicPathFromTag("#flashcards/sub"));
        expect(sub.newReviewItems[0]).toBe(
            core.remainingRoot.getDeck(TopicPath.getTopicPathFromTag("#flashcards/sub"))
                .newReviewItems[0],
        );
        expect(session).not.toBe(core.remainingRoot);
    });
});

describe("what depends on today is worked out again without reading the notes", () => {
    test("a question put on the bury list leaves the remaining cards, and returns on the next study day", async () => {
        const { fake, manager, processFile } = await started();
        await manager.sync();
        const core = manager.vaultIndex;
        const card = core.reviewableRoot.getDeck(TopicPath.getTopicPathFromTag("#flashcards/sub"))
            .newReviewItems[0];
        core.buriedCards.add(card.question);
        await manager.sync();
        expect(core.remainingRoot.getDistinctReviewItemCount(ReviewItemState.AnyItem, true)).toBe(
            2,
        );

        // The next study day: the list is cleared before the trees are filtered
        fake.data.buryDate = "2023-09-05";
        await manager.sync();
        expect(core.remainingRoot.getDistinctReviewItemCount(ReviewItemState.AnyItem, true)).toBe(
            3,
        );
        expect(processFile).toHaveBeenCalledTimes(3);
    });
});
