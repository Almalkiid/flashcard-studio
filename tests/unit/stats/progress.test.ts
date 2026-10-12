import { childDecks, deckProgress, progressRows } from "src/stats/progress";

import { statsCard } from "./fixtures";

const DECKS = [
    "CIA/Part1/Unit 01 - Purpose",
    "CIA/Part1/Unit 02 - Mandate",
    "CIA/Part2/Unit 01 - Objectives",
    "Spanish",
];

describe("childDecks", () => {
    test("lists the top-level decks for the empty scope, including decks only known through subdecks", () => {
        expect(childDecks(DECKS, "")).toEqual(["CIA", "Spanish"]);
    });

    test("lists the direct subdecks of a deck, not their own subdecks", () => {
        expect(childDecks(DECKS, "CIA")).toEqual(["CIA/Part1", "CIA/Part2"]);
        expect(childDecks(DECKS, "CIA/Part1")).toEqual([
            "CIA/Part1/Unit 01 - Purpose",
            "CIA/Part1/Unit 02 - Mandate",
        ]);
    });

    test("has none for a deck without subdecks or a deck that does not exist", () => {
        expect(childDecks(DECKS, "Spanish")).toEqual([]);
        expect(childDecks(DECKS, "Physics")).toEqual([]);
    });

    test("does not take a deck whose name only starts with the scope for a subdeck", () => {
        expect(childDecks(["CIA/Part1", "CIA2/Part1"], "CIA")).toEqual(["CIA/Part1"]);
    });
});

describe("deckProgress", () => {
    test("counts mastered (review, 21 days or more), seen (studied at least once) and the total", () => {
        const cards = [
            statsCard({ state: "new" }),
            statsCard({ state: "learning", intervalDays: 0 }),
            statsCard({ state: "relearning", intervalDays: 0 }),
            statsCard({ state: "review", intervalDays: 20.9 }),
            statsCard({ state: "review", intervalDays: 21 }),
            statsCard({ state: "review", intervalDays: 300 }),
        ];
        expect(deckProgress(cards, "CIA/Part1")).toEqual({
            deck: "CIA/Part1",
            total: 6,
            seen: 5,
            mastered: 2,
        });
    });

    test("counts suspended and buried cards by what was learnt, since pausing a card does not unlearn it", () => {
        const cards = [
            statsCard({ state: "review", intervalDays: 30, suspended: true }),
            statsCard({ state: "new", buried: true }),
        ];
        expect(deckProgress(cards, "CIA")).toEqual({ deck: "CIA", total: 2, seen: 1, mastered: 1 });
    });

    test("covers the subdecks of the deck and leaves other decks out", () => {
        const cards = [
            statsCard({ decks: ["CIA/Part1/Unit 01 - Purpose"], state: "new" }),
            statsCard({
                decks: ["CIA/Part2/Unit 01 - Objectives"],
                state: "review",
                intervalDays: 40,
            }),
            statsCard({ decks: ["Spanish"], state: "review", intervalDays: 40 }),
        ];
        expect(deckProgress(cards, "CIA/Part1")).toMatchObject({ total: 1, seen: 0, mastered: 0 });
        expect(deckProgress(cards, "CIA")).toMatchObject({ total: 2, seen: 1, mastered: 1 });
        expect(deckProgress(cards, "")).toMatchObject({ total: 3, seen: 2, mastered: 2 });
    });
});

describe("progressRows", () => {
    test("gives the scope's own progress and one row per direct subdeck, in deck order", () => {
        const cards = [
            statsCard({
                decks: ["CIA/Part1/Unit 01 - Purpose"],
                state: "review",
                intervalDays: 25,
            }),
            statsCard({ decks: ["CIA/Part1/Unit 02 - Mandate"], state: "new" }),
            statsCard({
                decks: ["CIA/Part2/Unit 01 - Objectives"],
                state: "learning",
                intervalDays: 0,
            }),
        ];
        const result = progressRows(cards, DECKS, "CIA");
        expect(result.scope).toEqual({ deck: "CIA", total: 3, seen: 2, mastered: 1 });
        expect(result.rows).toEqual([
            { deck: "CIA/Part1", total: 2, seen: 1, mastered: 1 },
            { deck: "CIA/Part2", total: 1, seen: 1, mastered: 0 },
        ]);
    });

    test("has no rows for a deck without subdecks", () => {
        const cards = [statsCard({ decks: ["Spanish"], state: "new" })];
        const result = progressRows(cards, DECKS, "Spanish");
        expect(result.rows).toEqual([]);
        expect(result.scope).toEqual({ deck: "Spanish", total: 1, seen: 0, mastered: 0 });
    });
});
