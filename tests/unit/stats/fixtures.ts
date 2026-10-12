import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { StatsCard } from "src/stats/types";

/** A review log entry with sensible defaults; override what the test cares about. */
export function entry(overrides: Partial<ReviewLogEntry> & { at?: string }): ReviewLogEntry {
    const { at, ...rest } = overrides;
    return {
        t: at ? new Date(at).getTime() : 0,
        c: "card01",
        r: 3,
        k: 1,
        ivl: 5,
        li: 3,
        ms: 5000,
        dk: "CIA/Part1",
        f: "CIA/Part1/Deck.md",
        ...rest,
    };
}

export const DAY_MS = 24 * 3600 * 1000;

/** A card with defaults for a young review card in deck `CIA/Part1`; override what the test cares about. */
export function statsCard(overrides: Partial<StatsCard> = {}): StatsCard {
    return {
        id: "abc123",
        decks: ["CIA/Part1"],
        state: "review",
        isFsrs: true,
        dueMs: null,
        intervalDays: 10,
        stability: 10,
        difficulty: 5,
        lastReviewMs: null,
        reps: 3,
        lapses: 0,
        suspended: false,
        buried: false,
        flag: 0,
        leech: false,
        ...overrides,
    };
}
