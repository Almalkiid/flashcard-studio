import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { trueRetention } from "src/stats/answers";
import { addDays, DayKeyFn } from "src/stats/day-keys";
import { StatsCard } from "src/stats/types";

/** A deck needs at least this many review answers in the last 30 days before its retention is judged. */
export const WEAK_AREA_MIN_REVIEWS = 10;

/** A card answered Again at least this often in the last 30 days is slipping. */
export const SLIPPING_MISSES = 2;

export interface DeckWeakness {
    /** The deck path, as the review log records it (`CIA/Part1`). */
    deck: string;
    /** True retention of the deck's review answers in the last 30 days, 0 to 1. */
    retention: number;
    /** The review answers behind that retention. */
    reviews: number;
    /** Cards of the deck that are due now (not new, not suspended). */
    due: number;
    /** Cards of the deck answered Again at least twice in the last 30 days. */
    slipping: number;
}

export interface WeakAreas {
    /** The decks with enough recent answers to judge, weakest first. */
    decks: DeckWeakness[];
    /** Cards answered Again at least twice in the last 30 days, in every deck. */
    slipping: number;
    /** Cards marked as leeches. */
    leeches: number;
}

/**
 * Where recall is weakest: each deck's true retention over the last 30 days (Anki's definition, see
 * `trueRetention`), ranked from the lowest, with the cards that keep being missed. Decks are the exact deck of each
 * answer, so a parent deck does not repeat its subdecks.
 */
export function weakAreas(
    entries: ReviewLogEntry[],
    cards: StatsCard[],
    todayKey: string,
    dayKeyOf: DayKeyFn,
    nowMs: number,
): WeakAreas {
    const fromKey = addDays(todayKey, -29);
    const byDeck = new Map<string, ReviewLogEntry[]>();
    const misses = new Map<string, { count: number; deck: string }>();
    for (const entry of entries) {
        if (dayKeyOf(entry.t) < fromKey) continue;
        let deckEntries = byDeck.get(entry.dk);
        if (deckEntries === undefined) byDeck.set(entry.dk, (deckEntries = []));
        deckEntries.push(entry);
        if (entry.r === 1 && entry.c !== "") {
            const miss = misses.get(entry.c) ?? { count: 0, deck: entry.dk };
            miss.count++;
            misses.set(entry.c, miss);
        }
    }

    const slippingByDeck = new Map<string, number>();
    let slipping = 0;
    for (const miss of misses.values()) {
        if (miss.count < SLIPPING_MISSES) continue;
        slipping++;
        slippingByDeck.set(miss.deck, (slippingByDeck.get(miss.deck) ?? 0) + 1);
    }

    const decks: DeckWeakness[] = [];
    for (const [deck, deckEntries] of byDeck) {
        const last30 = trueRetention(deckEntries, todayKey, dayKeyOf).find(
            (row) => row.id === "last30",
        );
        if (last30 === undefined || last30.all.rate === null) continue;
        if (last30.all.total < WEAK_AREA_MIN_REVIEWS) continue;
        decks.push({
            deck,
            retention: last30.all.rate,
            reviews: last30.all.total,
            due: cards.filter(
                (card) =>
                    card.decks.includes(deck) &&
                    card.state !== "new" &&
                    !card.suspended &&
                    card.dueMs !== null &&
                    card.dueMs <= nowMs,
            ).length,
            slipping: slippingByDeck.get(deck) ?? 0,
        });
    }
    decks.sort((a, b) => a.retention - b.retention || b.reviews - a.reviews);

    return { decks, slipping, leeches: cards.filter((card) => card.leech).length };
}
