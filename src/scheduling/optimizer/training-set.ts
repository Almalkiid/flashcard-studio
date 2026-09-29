import type { FsrsItem } from "ts-fsrs-optimizer";

import { ReviewLogEntry } from "src/data/review-log/review-log-entry";

const DAY_MS = 86400000;

/**
 * One review that the optimizer can learn from: the rating, the day it happened (after the day boundary) and the
 * whole days since the card's previous kept review (0 for the first).
 */
export interface OptimizerReview {
    t: number;
    rating: 1 | 2 | 3 | 4;
    deltaT: number;
}

export interface CardHistory {
    cardId: string;
    reviews: OptimizerReview[];
}

export interface TrainingSet {
    trainSet: FsrsItem[];
    /** The card of each item, as a number, in step with `trainSet`. */
    cardIds: number[];
}

export interface HistoryOptions {
    /** How long after midnight the day starts, in milliseconds (the "start of day" setting). */
    dayStartOffsetMs: number;
    /** Only use cards in this deck (a path such as `CIA/Part1`) or its subdecks. Empty for every deck. */
    deck?: string;
}

/**
 * The number of whole local days from a fixed origin to the day containing `epochMs`, after shifting the day start.
 * Built from calendar dates so daylight saving changes do not add or drop a day.
 */
export function dayNumber(epochMs: number, dayStartOffsetMs: number): number {
    const date = new Date(epochMs - dayStartOffsetMs);
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/**
 * A manual entry that left the card with no memory (a reset), as opposed to one that only moved its due date.
 */
function isReset(entry: ReviewLogEntry): boolean {
    return entry.r === 0 && entry.k === 4 && (entry.s ?? 0) === 0;
}

function isInDeck(deckOfCard: string, deck: string): boolean {
    const wanted = deck.replace(/^#/, "").replace(/\/+$/, "");
    return wanted === "" || deckOfCard === wanted || deckOfCard.startsWith(wanted + "/");
}

/**
 * Turns the review log into the review history of each card, following the FSRS optimizer's input rules:
 *
 * - manual entries (`r` 0) and cram answers (`k` 3) are ignored, because they say nothing about memory;
 * - entries from before a reset are dropped, because a reset card starts again from nothing;
 * - only the first answer of each day is kept for a card, and `deltaT` counts whole days between kept answers.
 *
 * Entries of every device are merged by time. Cards without an id are skipped.
 */
export function buildCardHistories(
    entries: readonly ReviewLogEntry[],
    options: HistoryOptions,
): CardHistory[] {
    const byCard = new Map<string, ReviewLogEntry[]>();
    for (const entry of entries) {
        if (entry.c === "") continue;
        const list = byCard.get(entry.c);
        if (list) list.push(entry);
        else byCard.set(entry.c, [entry]);
    }

    const histories: CardHistory[] = [];
    for (const [cardId, cardEntries] of byCard) {
        cardEntries.sort((a, b) => a.t - b.t);

        // The deck a card is in now is the one on its latest answer, so a moved card keeps its whole history
        if (options.deck && !isInDeck(cardEntries[cardEntries.length - 1].dk, options.deck)) {
            continue;
        }

        let lastReset = -1;
        cardEntries.forEach((entry, index) => {
            if (isReset(entry)) lastReset = index;
        });

        const reviews: OptimizerReview[] = [];
        let previousDay: number | null = null;
        for (const entry of cardEntries.slice(lastReset + 1)) {
            if (entry.r === 0 || entry.k === 3 || entry.k === 4) continue;
            const day = dayNumber(entry.t, options.dayStartOffsetMs);
            if (day === previousDay) continue;
            reviews.push({
                t: entry.t,
                rating: entry.r,
                deltaT: previousDay === null ? 0 : day - previousDay,
            });
            previousDay = day;
        }
        if (reviews.length > 0) histories.push({ cardId, reviews });
    }
    return histories.sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0));
}

/**
 * The number of reviews the optimizer learns from: every review of a card after its first.
 */
export function countTrainingReviews(histories: readonly CardHistory[]): number {
    return histories.reduce((total, history) => total + Math.max(0, history.reviews.length - 1), 0);
}

/**
 * Builds the optimizer's input. Each item is a card's history up to one review, and the last review in it is the one
 * to predict. Items are ordered by the time of that last review, as the optimizer requires.
 */
export function buildTrainingSet(histories: readonly CardHistory[]): TrainingSet {
    const rows: { t: number; cardIndex: number; length: number; item: FsrsItem }[] = [];
    histories.forEach((history, cardIndex) => {
        const reviews = history.reviews.map(({ rating, deltaT }) => ({ rating, deltaT }));
        for (let length = 2; length <= reviews.length; length++) {
            rows.push({
                t: history.reviews[length - 1].t,
                cardIndex,
                length,
                item: { reviews: reviews.slice(0, length) },
            });
        }
    });
    rows.sort((a, b) => a.t - b.t || a.cardIndex - b.cardIndex || a.length - b.length);
    return {
        trainSet: rows.map((row) => row.item),
        cardIds: rows.map((row) => row.cardIndex),
    };
}
