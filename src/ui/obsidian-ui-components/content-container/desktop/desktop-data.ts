import { Deck } from "src/data/data-structures/deck/deck";
import { Rating, ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { isReview } from "src/stats/activity";
import { Forecast, retrievability } from "src/stats/cards";
import { deckMatches } from "src/stats/scope";
import { CardState, StatsCard } from "src/stats/types";

/**
 * The data of the desktop screens that needs no DOM: which decks to list, and what the study side panel shows. Kept
 * apart from the rendering so it can be tested.
 */

/** Days shown by the "Coming up" chart on the home. */
export const FORECAST_DAYS = 7;

/** How many of a card's last answers the side panel shows. */
const LAST_ANSWERS_SHOWN = 5;

/**
 * The decks the sidebar tree starts from. A lone tag root such as `flashcards` is left out when it has subdecks and no
 * cards of its own, so the tree starts at `CIA` instead of `Flashcards › CIA`.
 */
export function topLevelDecks(root: Deck): Deck[] {
    if (root.subdecks.length === 1) {
        const only = root.subdecks[0];
        const holdsCards = only.newRepItems.length + only.dueRepItems.length > 0;
        if (only.subdecks.length > 0 && !holdsCards) return only.subdecks;
    }
    return root.subdecks;
}

/**
 * The decks the home table lists: each top level deck's children, or the deck itself when it has none, so `CIA` shows
 * as `CIA › Part 1`, `CIA › Part 2`. Cards that sit in a parent deck itself are counted in Study all and the sidebar
 * tree, not in a row of their own.
 */
export function tableDecks(root: Deck): Deck[] {
    return topLevelDecks(root).flatMap((deck) =>
        deck.subdecks.length > 0 ? deck.subdecks : [deck],
    );
}

/**
 * The names that label a deck: its path without the tag root that holds every deck (`flashcards`, when it is the only
 * top level deck), and at most the last two names. The same rule the Focus card uses.
 */
export function deckPathLabel(deck: Deck, root: Deck): string[] {
    let path = deck.getTopicPath().path;
    if (root.subdecks.length === 1 && path.length > 1) path = path.slice(1);
    return path.slice(-2);
}

/**
 * Cards in a learning or relearning step that are ready now, in the deck and its subdecks: the table's Learn column.
 * Suspended and buried cards are left out, as the queue leaves them out, and so are steps that are not up yet.
 */
export function learningCount(cards: StatsCard[], scope: string, nowMs: number): number {
    return cards.filter(
        (card) =>
            (card.state === "learning" || card.state === "relearning") &&
            !card.suspended &&
            !card.buried &&
            card.dueMs !== null &&
            card.dueMs <= nowMs &&
            card.decks.some((deck) => deckMatches(scope, deck)),
    ).length;
}

export interface SessionCounts {
    again: number;
    hard: number;
    good: number;
    easy: number;
}

/** How often each answer was given in the session, the same answers the progress bar colours. */
export function summarizeSessionAnswers(responses: readonly ReviewResponse[]): SessionCounts {
    const counts: SessionCounts = { again: 0, hard: 0, good: 0, easy: 0 };
    for (const response of responses) {
        if (response === ReviewResponse.Again) counts.again++;
        else if (response === ReviewResponse.Hard) counts.hard++;
        else if (response === ReviewResponse.Good) counts.good++;
        else if (response === ReviewResponse.Easy) counts.easy++;
    }
    return counts;
}

/** What the "This card" block of the side panel shows. */
export interface CardInfoData {
    state: CardState;
    lastSeenMs: number | null;
    /** FSRS stability in days; null for other algorithms and new cards. */
    stabilityDays: number | null;
    /** The chance of recalling the card now, 0 to 1; null without FSRS memory state. */
    recall: number | null;
    lapses: number;
    /** Ratings 1 to 4 of the card's last answers, oldest first. */
    lastAnswers: Rating[];
}

/**
 * The card info of the side panel, from the same pieces the card info window uses: the card's statistics
 * (`toStatsCard`), its retrievability and its answers in the review log.
 */
export function buildCardInfoData(
    stats: StatsCard,
    entries: readonly ReviewLogEntry[],
    nowMs: number,
): CardInfoData {
    const answers =
        stats.id === null || stats.id === ""
            ? []
            : entries.filter((entry) => entry.c === stats.id && isReview(entry));
    const last = answers.length === 0 ? null : answers[answers.length - 1];
    // Cards on the older algorithm carry no lapse count or last review, so they come from the log
    const lapses = stats.isFsrs
        ? stats.lapses
        : answers.filter((entry) => entry.k === 1 && entry.r === 1).length;
    return {
        state: stats.state,
        lastSeenMs: stats.lastReviewMs ?? (last === null ? null : last.t),
        stabilityDays: stats.isFsrs && stats.stability > 0 ? stats.stability : null,
        recall: retrievability(stats, nowMs),
        lapses,
        lastAnswers: answers.slice(-LAST_ANSWERS_SHOWN).map((entry) => entry.r),
    };
}

/**
 * Whether a retention is under the target, compared at the precision it is shown at (a whole percent). Compared raw, a
 * deck that reads "90%" against a 90% target could still be drawn as under it.
 */
export function retentionBelowTarget(rate: number, target: number): boolean {
    return Math.round(rate * 100) < Math.round(target * 100);
}

/** Cards due on each of the next seven days; the cards overdue count for today. */
export function forecastForHome(forecast: Forecast): number[] {
    const days = forecast.days.slice(0, FORECAST_DAYS);
    while (days.length < FORECAST_DAYS) days.push(0);
    days[0] += forecast.overdue;
    return days;
}

/** A session clock: `03:12`, or `1:02:03` from the first hour. */
export function clockText(ms: number): string {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (value: number) => String(value).padStart(2, "0");
    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(seconds)}`
        : `${pad(minutes)}:${pad(seconds)}`;
}
