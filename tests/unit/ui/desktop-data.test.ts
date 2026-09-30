import { Deck } from "src/data/data-structures/deck/deck";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import {
    buildCardInfoData,
    clockText,
    deckPathLabel,
    forecastForHome,
    learningCount,
    summarizeSessionAnswers,
    tableDecks,
    topLevelDecks,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-data";

import { DAY_MS, entry, statsCard } from "../stats/fixtures";

/** A deck tree from a list of paths; `own` lists the paths that hold a card of their own. */
function tree(paths: string[], own: string[] = []): Deck {
    const root = new Deck("Root", null);
    for (const path of paths) {
        let deck = root;
        const walked: string[] = [];
        for (const name of path.split("/")) {
            walked.push(name);
            let child = deck.subdecks.find((candidate) => candidate.deckName === name);
            if (child === undefined) {
                child = new Deck(name, deck);
                deck.subdecks.push(child);
                if (own.includes(walked.join("/"))) child.newRepItems.push({} as never);
            }
            deck = child;
        }
    }
    return root;
}

const names = (decks: Deck[]) => decks.map((deck) => deck.getTopicPath().path.join("/"));

describe("topLevelDecks", () => {
    test("skips a lone tag root that has subdecks, and no cards of its own", () => {
        const root = tree(["flashcards/cia/part1", "flashcards/arabic"]);
        expect(names(topLevelDecks(root))).toEqual(["flashcards/cia", "flashcards/arabic"]);
    });

    test("keeps a lone root that holds cards itself, so no card disappears", () => {
        const root = tree(["flashcards/cia"], ["flashcards"]);
        expect(names(topLevelDecks(root))).toEqual(["flashcards"]);
    });

    test("keeps a lone root without subdecks", () => {
        expect(names(topLevelDecks(tree(["flashcards"])))).toEqual(["flashcards"]);
    });

    test("keeps several roots as they are", () => {
        expect(names(topLevelDecks(tree(["flashcards/a", "review/b"])))).toEqual([
            "flashcards",
            "review",
        ]);
    });

    test("an empty collection has no decks", () => {
        expect(topLevelDecks(tree([]))).toEqual([]);
    });
});

describe("tableDecks", () => {
    test("lists the children of each top level deck, and a deck without children itself", () => {
        const root = tree([
            "flashcards/cia/part1/unit1",
            "flashcards/cia/part2",
            "flashcards/cia/part3",
            "flashcards/arabic",
        ]);
        expect(names(tableDecks(root))).toEqual([
            "flashcards/cia/part1",
            "flashcards/cia/part2",
            "flashcards/cia/part3",
            "flashcards/arabic",
        ]);
    });
});

describe("deckPathLabel", () => {
    test("leaves out a lone tag root and keeps the last two names", () => {
        const root = tree(["flashcards/cia/part1/unit1", "flashcards/arabic"]);
        const unit = root.subdecks[0].subdecks[0].subdecks[0].subdecks[0];
        expect(deckPathLabel(unit, root)).toEqual(["part1", "unit1"]);
        const arabic = root.subdecks[0].subdecks[1];
        expect(deckPathLabel(arabic, root)).toEqual(["arabic"]);
    });

    test("leaves the tag root out when it holds cards too, but not for the root itself", () => {
        const root = tree(["flashcards/anatomy"], ["flashcards"]);
        expect(deckPathLabel(root.subdecks[0].subdecks[0], root)).toEqual(["anatomy"]);
        expect(deckPathLabel(root.subdecks[0], root)).toEqual(["flashcards"]);
    });

    test("with several roots the root is part of the label", () => {
        const root = tree(["flashcards/a", "review/b"]);
        expect(deckPathLabel(root.subdecks[1].subdecks[0], root)).toEqual(["review", "b"]);
    });
});

describe("learningCount", () => {
    const now = Date.UTC(2026, 8, 30, 12);

    test("counts learning and relearning cards that are due now, in the deck and its subdecks", () => {
        const cards = [
            statsCard({ state: "learning", decks: ["cia/part1"], dueMs: now - 60_000 }),
            statsCard({ state: "relearning", decks: ["cia"], dueMs: now }),
            statsCard({ state: "learning", decks: ["arabic"], dueMs: now }),
            statsCard({ state: "review", decks: ["cia"], dueMs: now }),
            statsCard({ state: "new", decks: ["cia"], dueMs: null }),
        ];
        expect(learningCount(cards, "cia", now)).toBe(2);
        expect(learningCount(cards, "arabic", now)).toBe(1);
        expect(learningCount(cards, "", now)).toBe(3);
    });

    test("leaves out suspended and buried cards and cards whose step is not up yet", () => {
        const cards = [
            statsCard({ state: "learning", decks: ["cia"], dueMs: now, suspended: true }),
            statsCard({ state: "learning", decks: ["cia"], dueMs: now, buried: true }),
            statsCard({ state: "learning", decks: ["cia"], dueMs: now + 600_000 }),
        ];
        expect(learningCount(cards, "cia", now)).toBe(0);
    });
});

describe("summarizeSessionAnswers", () => {
    test("counts each answer of the session", () => {
        const counts = summarizeSessionAnswers([
            ReviewResponse.Good,
            ReviewResponse.Again,
            ReviewResponse.Good,
            ReviewResponse.Easy,
        ]);
        expect(counts).toEqual({ again: 1, hard: 0, good: 2, easy: 1 });
    });

    test("no answers gives zeros", () => {
        expect(summarizeSessionAnswers([])).toEqual({ again: 0, hard: 0, good: 0, easy: 0 });
    });
});

describe("buildCardInfoData", () => {
    const now = Date.UTC(2026, 9, 1);

    test("reads the state, last seen, stability, recall and lapses of a FSRS card", () => {
        const stats = statsCard({
            id: "c1",
            state: "review",
            stability: 5.8,
            lastReviewMs: now - 6 * DAY_MS,
            lapses: 1,
        });
        const data = buildCardInfoData(stats, [], now);
        expect(data.state).toBe("review");
        expect(data.lastSeenMs).toBe(now - 6 * DAY_MS);
        expect(data.stabilityDays).toBe(5.8);
        expect(data.recall).toBeGreaterThan(0.5);
        expect(data.recall).toBeLessThan(1);
        expect(data.lapses).toBe(1);
    });

    test("the last five answers of this card only, oldest first", () => {
        const stats = statsCard({ id: "c1" });
        const answers = [1, 3, 3, 2, 3, 4, 1].map((r, index) =>
            entry({ c: "c1", r: r as 1, t: index * 1000 }),
        );
        const other = entry({ c: "other", r: 4, t: 99_000 });
        const manual = entry({ c: "c1", r: 0, k: 4, t: 98_000 });
        const data = buildCardInfoData(stats, [...answers, other, manual], now);
        expect(data.lastAnswers).toEqual([3, 2, 3, 4, 1]);
    });

    test("a new card has nothing to show yet", () => {
        const stats = statsCard({
            id: null,
            state: "new",
            stability: 0,
            lastReviewMs: null,
            reps: 0,
            lapses: 0,
        });
        const data = buildCardInfoData(stats, [entry({ c: "" })], now);
        expect(data).toEqual({
            state: "new",
            lastSeenMs: null,
            stabilityDays: null,
            recall: null,
            lapses: 0,
            lastAnswers: [],
        });
    });

    test("an SM-2 card takes its last seen time and lapses from the log", () => {
        const stats = statsCard({ id: "c1", isFsrs: false, stability: 0, lastReviewMs: null });
        const entries = [
            entry({ c: "c1", r: 3, k: 1, t: 1000 }),
            entry({ c: "c1", r: 1, k: 1, t: 2000 }),
            entry({ c: "c1", r: 3, k: 2, t: 3000 }),
        ];
        const data = buildCardInfoData(stats, entries, now);
        expect(data.lastSeenMs).toBe(3000);
        expect(data.stabilityDays).toBeNull();
        expect(data.recall).toBeNull();
        expect(data.lapses).toBe(1);
    });
});

describe("forecastForHome", () => {
    test("adds the overdue cards to today and keeps seven days", () => {
        const days = forecastForHome({
            overdue: 3,
            days: [4, 1, 0, 2, 2, 5, 6, 9, 9],
            beyond: 10,
            total: 51,
        });
        expect(days).toEqual([7, 1, 0, 2, 2, 5, 6]);
    });

    test("pads a short forecast with zeros", () => {
        expect(forecastForHome({ overdue: 0, days: [2, 1], beyond: 0, total: 3 })).toEqual([
            2, 1, 0, 0, 0, 0, 0,
        ]);
    });
});

describe("clockText", () => {
    test("minutes and seconds, then hours", () => {
        expect(clockText(0)).toBe("00:00");
        expect(clockText(192_000)).toBe("03:12");
        expect(clockText(59 * 60_000 + 59_999)).toBe("59:59");
        expect(clockText(3_723_000)).toBe("1:02:03");
    });

    test("never shows a negative time", () => {
        expect(clockText(-5000)).toBe("00:00");
    });
});
