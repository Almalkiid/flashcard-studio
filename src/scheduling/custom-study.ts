import { isBuried } from "src/data/card-meta";
import { TICKS_PER_DAY } from "src/data/constants";
import { Card } from "src/data/data-structures/card/card";
import { Deck } from "src/data/data-structures/deck/deck";
import { LimitOverride } from "src/data/plugin-data";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { ExtraAllowance } from "src/scheduling/daily-limits";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";

/**
 * What a custom study session shows, like the options of Anki's Custom Study.
 *
 * - `forgotten`: cards answered Again in the last `days` days (1 is today), or since `sinceMs` when it is set (the
 *   start of a session, for "Review mistakes"). Cram, nothing is rescheduled.
 * - `ahead`: cards that fall due within the next `days` days. Reviewed like any review, so FSRS reschedules them.
 * - `preview`: the first `count` new cards. Cram, so they stay new.
 * - `filter`: cards picked by deck, state, flag colour or leech mark. Cram.
 */
export type CustomStudySpec =
    | { type: "forgotten"; days: number; sinceMs?: number }
    | { type: "ahead"; days: number }
    | { type: "preview"; count: number }
    | {
          type: "filter";
          /** Deck or tag paths such as `CIA/Part1`; a card matches when it is in any of them or their subdecks. Empty for all. */
          decks: string[];
          state: "all" | "new" | "due";
          /** 1 to 7 for a flag colour, 0 for any card. */
          flag: number;
          leechOnly: boolean;
          /** The most cards to study; 0 for no limit. */
          count: number;
      };

/**
 * What the predicates need to know about the moment the session starts.
 */
export interface CustomStudyContext {
    nowMs: number;
    /** Today after the day boundary, `YYYY-MM-DD`. */
    todayYmd: string;
    /** Ids of the cards answered Again in the period, from the review log. Only needed for `forgotten`. */
    forgottenIds: ReadonlySet<string>;
}

export function customStudyMode(spec: CustomStudySpec): FlashcardReviewMode {
    return spec.type === "ahead" ? FlashcardReviewMode.Review : FlashcardReviewMode.Cram;
}

// #region -> Predicates

export function isForgotten(card: Card, forgottenIds: ReadonlySet<string>): boolean {
    return card.meta.id !== null && forgottenIds.has(card.meta.id);
}

/**
 * Whether a card that has been reviewed before falls due within `days` days of now (overdue cards included).
 */
export function isDueWithin(card: Card, days: number, nowMs: number): boolean {
    return !card.isNew && card.scheduleInfo.dueDateAsUnix <= nowMs + days * TICKS_PER_DAY;
}

/**
 * Whether a card is in a deck (or tag path) or one of its subdecks.
 */
export function isInDeck(card: Card, deckPath: string): boolean {
    const wanted = deckPath.split("/").filter((part) => part.length > 0);
    return (card.question?.topicPathList?.list ?? []).some(
        (topicPath) =>
            topicPath.path.length >= wanted.length &&
            wanted.every((part, index) => topicPath.path[index] === part),
    );
}

/**
 * Suspended cards and cards buried until a later day are never part of a session.
 */
export function isAvailable(card: Card, todayYmd: string): boolean {
    return !card.meta.suspended && !isBuried(card.meta, todayYmd);
}

/**
 * The cards a session picks, before any limit on their number. `preview` and `filter` sessions apply their limit in
 * {@link buildCustomStudyTree}.
 */
export function customStudyPredicate(
    spec: CustomStudySpec,
    context: CustomStudyContext,
): (card: Card) => boolean {
    const available = (card: Card) => isAvailable(card, context.todayYmd);
    switch (spec.type) {
        case "forgotten":
            return (card) => available(card) && isForgotten(card, context.forgottenIds);
        case "ahead":
            return (card) => available(card) && isDueWithin(card, spec.days, context.nowMs);
        case "preview":
            return (card) => available(card) && card.isNew;
        case "filter":
            return (card) => {
                if (!available(card)) return false;
                if (spec.state === "new" && !card.isNew) return false;
                if (spec.state === "due" && !card.isDue) return false;
                if (spec.flag > 0 && card.meta.flag !== spec.flag) return false;
                if (spec.leechOnly && !card.meta.leech) return false;
                return spec.decks.length === 0 || spec.decks.some((deck) => isInDeck(card, deck));
            };
    }
}

/**
 * Keeps only the first `limit` cards a predicate accepts, in the order the deck tree is walked. A card that sits in
 * several decks counts once. A limit of 0 or less keeps everything.
 */
export function limitCards(
    predicate: (card: Card) => boolean,
    limit: number,
): (card: Card) => boolean {
    if (limit <= 0) return predicate;
    const accepted = new Set<Card>();
    return (card) => {
        if (accepted.has(card)) return true;
        if (accepted.size >= limit || !predicate(card)) return false;
        accepted.add(card);
        return true;
    };
}

function cardLimit(spec: CustomStudySpec): number {
    if (spec.type === "preview" || spec.type === "filter") return spec.count;
    return 0;
}

/**
 * The deck tree a custom study session is served from: a copy of the full tree that only holds the chosen cards, in
 * the same decks. The sequencer takes it in place of the normal queue.
 */
export function buildCustomStudyTree(
    fullTree: Deck,
    spec: CustomStudySpec,
    context: CustomStudyContext,
): Deck {
    const predicate = limitCards(customStudyPredicate(spec, context), cardLimit(spec));
    return fullTree.copyWithRepItemFilter(predicate);
}

// #endregion

// #region -> Review log

/**
 * The review log months (`YYYY-MM`) from the one containing `startMs` to the one containing `endMs`, so a
 * "last N days" question reads every log file that can hold an answer.
 */
export function monthsBetween(startMs: number, endMs: number): string[] {
    const months: string[] = [];
    const start = new Date(startMs);
    const end = new Date(endMs);
    let year = start.getFullYear();
    let month = start.getMonth();
    while (year < end.getFullYear() || (year === end.getFullYear() && month <= end.getMonth())) {
        months.push(`${year}-${String(month + 1).padStart(2, "0")}`);
        month++;
        if (month > 11) {
            month = 0;
            year++;
        }
    }
    return months;
}

/**
 * The ids of the cards answered Again at or after `sinceMs`, from any device.
 */
export function forgottenCardIds(entries: ReviewLogEntry[], sinceMs: number): Set<string> {
    const ids = new Set<string>();
    for (const entry of entries) {
        if (entry.t >= sinceMs && entry.r === 1 && entry.c !== "") ids.add(entry.c);
    }
    return ids;
}

// #endregion

// #region -> Today's limits

/**
 * The extra allowance that counts today: the override when it was set today, nothing when it is from an earlier day.
 */
export function allowanceFor(
    override: LimitOverride | undefined,
    todayYmd: string,
): ExtraAllowance {
    if (!override || override.date !== todayYmd) return { extraNew: 0, extraReviews: 0 };
    return {
        extraNew: Math.max(0, override.extraNew),
        extraReviews: Math.max(0, override.extraReviews),
    };
}

/**
 * Adds to today's extra new cards or reviews. A new day starts again from nothing.
 */
export function increaseAllowance(
    override: LimitOverride | undefined,
    todayYmd: string,
    kind: "new" | "reviews",
    count: number,
): LimitOverride {
    const current = allowanceFor(override, todayYmd);
    return {
        date: todayYmd,
        extraNew: current.extraNew + (kind === "new" ? count : 0),
        extraReviews: current.extraReviews + (kind === "reviews" ? count : 0),
    };
}

// #endregion
