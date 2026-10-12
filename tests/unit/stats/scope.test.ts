import { makeDayKeyFn } from "src/stats/day-keys";
import {
    deckMatches,
    filterCardsByDeck,
    filterEntriesByDeck,
    filterEntriesByRange,
    rangeStartKey,
} from "src/stats/scope";

import { entry, statsCard } from "./fixtures";

const dayKey = makeDayKeyFn(0);
const TODAY = "2026-09-29";

describe("deckMatches", () => {
    test("the empty scope matches every deck", () => {
        expect(deckMatches("", "CIA/Part1")).toBe(true);
        expect(deckMatches("", "")).toBe(true);
    });

    test("matches the deck itself and its subdecks, not siblings with the same prefix", () => {
        expect(deckMatches("CIA", "CIA")).toBe(true);
        expect(deckMatches("CIA", "CIA/Part1")).toBe(true);
        expect(deckMatches("CIA", "CIA/Part1/Deep")).toBe(true);
        expect(deckMatches("CIA", "CIAX")).toBe(false);
        expect(deckMatches("CIA/Part1", "CIA")).toBe(false);
    });
});

describe("filterEntriesByDeck", () => {
    const entries = [
        entry({ dk: "CIA/Part1" }),
        entry({ dk: "CIA/Part2" }),
        entry({ dk: "Spanish" }),
    ];

    test("keeps entries of the deck and its subdecks", () => {
        expect(filterEntriesByDeck(entries, "CIA")).toHaveLength(2);
        expect(filterEntriesByDeck(entries, "CIA/Part2")).toHaveLength(1);
        expect(filterEntriesByDeck(entries, "Nope")).toHaveLength(0);
    });

    test("the empty scope returns the same entries", () => {
        expect(filterEntriesByDeck(entries, "")).toBe(entries);
    });
});

describe("filterCardsByDeck", () => {
    test("a card belongs to the scope when any of its decks does", () => {
        const both = statsCard({ decks: ["Spanish", "CIA/Part1"] });
        const other = statsCard({ decks: ["Spanish"] });
        expect(filterCardsByDeck([both, other], "CIA")).toEqual([both]);
    });

    test("a card in the root deck only matches the empty scope", () => {
        const root = statsCard({ decks: [""] });
        expect(filterCardsByDeck([root], "")).toEqual([root]);
        expect(filterCardsByDeck([root], "CIA")).toEqual([]);
    });
});

describe("rangeStartKey", () => {
    test("counts today as the last day of the range", () => {
        expect(rangeStartKey("1m", TODAY)).toEqual("2026-08-31");
        expect(rangeStartKey("3m", TODAY)).toEqual("2026-07-02");
        expect(rangeStartKey("1y", TODAY)).toEqual("2025-09-30");
    });

    test("all history has no start", () => {
        expect(rangeStartKey("all", TODAY)).toBeNull();
    });
});

describe("filterEntriesByRange", () => {
    const entries = [
        entry({ at: "2026-08-30T12:00:00Z" }),
        entry({ at: "2026-08-31T00:00:00Z" }),
        entry({ at: "2026-09-29T12:00:00Z" }),
    ];

    test("keeps the entries whose study day is inside the range", () => {
        const kept = filterEntriesByRange(entries, "1m", TODAY, dayKey);
        expect(kept.map((e) => e.t)).toEqual([entries[1].t, entries[2].t]);
    });

    test("all keeps everything", () => {
        expect(filterEntriesByRange(entries, "all", TODAY, dayKey)).toBe(entries);
    });

    test("empty input gives empty output", () => {
        expect(filterEntriesByRange([], "1m", TODAY, dayKey)).toEqual([]);
    });
});
