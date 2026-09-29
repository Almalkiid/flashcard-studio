/**
 * Shared types of the statistics aggregation. Nothing in `src/stats` imports Obsidian, so every function is a plain
 * function of its inputs and can be unit tested with fixtures.
 */

/** How far back the time-based charts look. */
export type TimeRange = "1m" | "3m" | "1y" | "all";

export const TIME_RANGES: readonly TimeRange[] = ["1m", "3m", "1y", "all"];

/** Days covered by each range; null means the whole history. */
export const RANGE_DAYS: Record<TimeRange, number | null> = {
    "1m": 30,
    "3m": 90,
    "1y": 365,
    all: null,
};

/** The learning state of a card, the same four states FSRS uses. SM-2 cards are only ever `new` or `review`. */
export type CardState = "new" | "learning" | "review" | "relearning";

/**
 * What the statistics need to know about one card, copied out of the deck tree so the aggregation stays free of
 * Obsidian and plugin classes.
 *
 * @property {string | null} id - The card id, null while the card has never been written with metadata.
 * @property {string[]} decks - Every deck path the card is in; "" stands for the root deck.
 * @property {boolean} isFsrs - Whether the card carries FSRS memory state (stability and difficulty).
 * @property {number | null} dueMs - When the card is next due, null for new cards.
 * @property {number} intervalDays - The scheduled interval; 0 for new cards.
 * @property {number} stability - FSRS stability in days, 0 when unknown.
 * @property {number} difficulty - FSRS difficulty from 1 to 10, 0 when unknown.
 * @property {number | null} lastReviewMs - When the card was last reviewed, null when unknown.
 */
export interface StatsCard {
    id: string | null;
    decks: string[];
    state: CardState;
    isFsrs: boolean;
    dueMs: number | null;
    intervalDays: number;
    stability: number;
    difficulty: number;
    lastReviewMs: number | null;
    reps: number;
    lapses: number;
    suspended: boolean;
    buried: boolean;
    flag: number;
    leech: boolean;
}

/** Cards with an interval of at least this many days are mature, as in Anki. */
export const MATURE_INTERVAL_DAYS = 21;
