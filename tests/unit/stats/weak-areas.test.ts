import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { makeDayKeyFn } from "src/stats/day-keys";
import { weakAreas } from "src/stats/weak-areas";

import { DAY_MS, entry, statsCard } from "./fixtures";

const NOW = new Date("2026-09-29T12:00:00Z").getTime();
const TODAY = "2026-09-29";
const dayKeyOf = makeDayKeyFn(0);

/** `total` review answers in `deck` on one day, the first `passed` of them remembered, each for its own card. */
function answers(deck: string, total: number, passed: number, at = "2026-09-28T09:00:00Z") {
    return Array.from({ length: total }, (_, i) =>
        entry({ at, dk: deck, c: `${deck}-${i}`, r: i < passed ? 3 : 1 }),
    );
}

describe("weakAreas", () => {
    test("ranks decks from the lowest 30 day retention", () => {
        const entries = [...answers("Strong", 10, 9), ...answers("Weak", 10, 6)];
        const result = weakAreas(entries, [], TODAY, dayKeyOf, NOW);
        expect(result.decks.map((deck) => [deck.deck, deck.retention, deck.reviews])).toEqual([
            ["Weak", 0.6, 10],
            ["Strong", 0.9, 10],
        ]);
    });

    test("leaves out decks with too few recent review answers to judge", () => {
        const entries = [...answers("Judged", 10, 5), ...answers("Too few", 9, 0)];
        expect(weakAreas(entries, [], TODAY, dayKeyOf, NOW).decks.map((d) => d.deck)).toEqual([
            "Judged",
        ]);
    });

    test("only counts the last 30 days", () => {
        const entries = [
            ...answers("Deck", 10, 10),
            ...answers("Deck", 10, 0, "2026-08-01T09:00:00Z").map((old, i) => ({
                ...old,
                c: `old-${i}`,
            })),
        ];
        const [deck] = weakAreas(entries, [], TODAY, dayKeyOf, NOW).decks;
        expect(deck.retention).toEqual(1);
        expect(deck.reviews).toEqual(10);
    });

    test("counts cards missed twice or more as slipping, per deck and overall", () => {
        const entries: ReviewLogEntry[] = [
            ...answers("Deck", 10, 10),
            entry({ at: "2026-09-20T09:00:00Z", dk: "Deck", c: "twice", r: 1 }),
            entry({ at: "2026-09-25T09:00:00Z", dk: "Deck", c: "twice", r: 1 }),
            entry({ at: "2026-09-25T09:00:00Z", dk: "Deck", c: "once", r: 1 }),
            entry({ at: "2026-09-26T09:00:00Z", dk: "Other", c: "other", r: 1, k: 0 }),
            entry({ at: "2026-09-27T09:00:00Z", dk: "Other", c: "other", r: 1, k: 2 }),
        ];
        const cards = [statsCard({ leech: true }), statsCard({ id: "x" })];
        const result = weakAreas(entries, cards, TODAY, dayKeyOf, NOW);
        expect(result.slipping).toEqual(2);
        expect(result.decks.find((deck) => deck.deck === "Deck")?.slipping).toEqual(1);
        expect(result.leeches).toEqual(1);
    });

    test("counts the cards of a deck that are due now", () => {
        const cards = [
            statsCard({ id: "due", decks: ["Deck"], dueMs: NOW - DAY_MS }),
            statsCard({ id: "later", decks: ["Deck"], dueMs: NOW + DAY_MS }),
            statsCard({ id: "new", decks: ["Deck"], state: "new", dueMs: null }),
            statsCard({ id: "off", decks: ["Deck"], dueMs: NOW - DAY_MS, suspended: true }),
            statsCard({ id: "elsewhere", decks: ["Other"], dueMs: NOW - DAY_MS }),
        ];
        const [deck] = weakAreas(answers("Deck", 10, 7), cards, TODAY, dayKeyOf, NOW).decks;
        expect(deck.due).toEqual(1);
    });

    test("has nothing to rank without answers", () => {
        expect(weakAreas([], [], TODAY, dayKeyOf, NOW)).toEqual({
            decks: [],
            slipping: 0,
            leeches: 0,
        });
    });
});
