import { DeckStats } from "src/scheduling/review/deck-stats";
import { hiddenByLimit, hiddenByLimitText, withHiddenNote } from "src/ui/deck-counts";

const stats = (newHidden: number, dueHidden: number): DeckStats =>
    new DeckStats(10, 3, 2, 5, 3, 2, 5, 0, 1, newHidden, dueHidden);

describe("cards held back by today's limit", () => {
    test("adds the new and the due cards that the limits hold back", () => {
        expect(hiddenByLimit(stats(2, 1))).toBe(3);
        expect(hiddenByLimitText(stats(2, 1))).toBe("3 hidden by today's limit");
    });

    test("says nothing when the limits hold nothing back", () => {
        expect(hiddenByLimitText(stats(0, 0))).toBe("");
        expect(withHiddenNote("5 cards", stats(0, 0))).toBe("5 cards");
    });

    test("is appended to another text", () => {
        expect(withHiddenNote("5 cards", stats(4, 0))).toBe("5 cards · 4 hidden by today's limit");
    });
});
