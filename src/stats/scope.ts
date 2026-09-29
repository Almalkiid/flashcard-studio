import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { addDays, DayKeyFn } from "src/stats/day-keys";
import { RANGE_DAYS, StatsCard, TimeRange } from "src/stats/types";

/**
 * Whether a deck falls inside a deck scope. The scope is a deck path such as `CIA` and covers that deck and all its
 * subdecks; the empty scope covers every deck.
 */
export function deckMatches(scope: string, deck: string): boolean {
    return scope === "" || deck === scope || deck.startsWith(scope + "/");
}

/** Keeps the entries whose deck is inside the scope. Returns the input unchanged for the empty scope. */
export function filterEntriesByDeck(entries: ReviewLogEntry[], scope: string): ReviewLogEntry[] {
    if (scope === "") return entries;
    return entries.filter((entry) => deckMatches(scope, entry.dk));
}

/** Keeps the cards that are in at least one deck inside the scope. */
export function filterCardsByDeck(cards: StatsCard[], scope: string): StatsCard[] {
    if (scope === "") return cards;
    return cards.filter((card) => card.decks.some((deck) => deckMatches(scope, deck)));
}

/**
 * The first study day of a range, counting today as its last day; null for the whole history.
 */
export function rangeStartKey(range: TimeRange, todayKey: string): string | null {
    const days = RANGE_DAYS[range];
    return days === null ? null : addDays(todayKey, -(days - 1));
}

/** Keeps the entries answered on a study day inside the range. Returns the input unchanged for `all`. */
export function filterEntriesByRange(
    entries: ReviewLogEntry[],
    range: TimeRange,
    todayKey: string,
    dayKeyOf: DayKeyFn,
): ReviewLogEntry[] {
    const startKey = rangeStartKey(range, todayKey);
    if (startKey === null) return entries;
    return entries.filter((entry) => dayKeyOf(entry.t) >= startKey);
}
