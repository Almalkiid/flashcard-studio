import { Card } from "src/data/data-structures/card/flashcard";
import { PREFERRED_DATE_FORMAT } from "src/data/formats";
import { FSRS_COMMENT_PREFIX, isReviewCard } from "src/scheduling/schedule/fsrs-state";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { formatDate } from "src/utils/clock";
import { CommentParser } from "src/utils/schedule-comment";

/**
 * Postponing pushes review cards that are due today or overdue out by some days, for a holiday or a backlog.
 * Only the due date changes: FSRS works out how much was forgotten from the time since the last review, and the
 * original plugin's scheduler from how late the card is, so the delay is accounted for when the card is answered.
 */
export interface PostponeOptions {
    /** The start of today, after the day boundary, in epoch milliseconds. */
    todayStartMs: number;
    /** How many days later the cards become due. */
    days: number;
}

function addDays(epochMs: number, days: number): number {
    const date = new Date(epochMs);
    date.setDate(date.getDate() + days);
    return date.getTime();
}

/**
 * The new due date: `days` days after the later of the old due date and the start of today, so a card that is weeks
 * overdue is not left overdue by a short delay.
 */
export function postponedDueMs(dueMs: number, options: PostponeOptions): number {
    return addDays(Math.max(dueMs, options.todayStartMs), options.days);
}

/**
 * Whether a schedule is a review card that is due today or overdue. Cards being learned, new cards and cards due
 * on a later day are left alone.
 */
export function isPostponable(schedule: ScheduleState | null, todayStartMs: number): boolean {
    return isReviewCard(schedule) && schedule.dueDateAsUnix < addDays(todayStartMs, 1);
}

/**
 * The cards postponing would move, each counted once even when it sits in several decks.
 */
export function cardsToPostpone(cards: Iterable<Card>, todayStartMs: number): Card[] {
    const result = new Set<Card>();
    for (const card of cards) {
        if (!card.meta.suspended && isPostponable(card.scheduleInfo, todayStartMs)) {
            result.add(card);
        }
    }
    return [...result];
}

/**
 * Postpones one schedule segment of a `<!--SR:...-->` comment (the text between two `!`).
 *
 * @returns The changed segment, or null when it is left alone.
 */
function postponeSegment(segment: string, options: PostponeOptions): string | null {
    const trimmed = segment.trim();
    if (trimmed.length === 0) return null;

    const fields = trimmed.split(",");
    const schedule = CommentParser.parseScheduleSegment(trimmed);
    if (schedule === null || fields.includes("susp")) return null;
    if (!isPostponable(schedule, options.todayStartMs)) return null;

    const newDue = postponedDueMs(schedule.dueDateAsUnix, options);
    if (fields[0] === FSRS_COMMENT_PREFIX) fields[1] = new Date(newDue).toISOString();
    else fields[0] = formatDate(newDue, PREFERRED_DATE_FORMAT);
    return segment.replace(trimmed, fields.join(","));
}

/**
 * Postpones every review card in a note's text that is due today or overdue, leaving all other text byte-identical.
 * It works on the text like the unsuspend and unbury commands, so it can run inside one atomic file rewrite.
 *
 * @param only - The cards to move, by their place in the question: when given, the text is one question's, and only the
 * segments of those cards in its first comment move, whatever else is due.
 * @returns The new text and how many cards were postponed.
 */
export function postponeInText(
    text: string,
    options: PostponeOptions,
    only?: ReadonlySet<number>,
): { text: string; count: number } {
    let count = 0;
    let seen = 0;
    const newText = text.replace(/<!--SR:(.+?)-->/g, (match: string, comment: string) => {
        const isFirst = seen++ === 0;
        if (only !== undefined && !isFirst) return match;
        // The comment starts with "!", so the segment of card n is the one at n + 1
        const lead = comment.startsWith("!") ? 1 : 0;
        const segments = comment.split("!").map((segment, at) => {
            if (only !== undefined && !only.has(at - lead)) return segment;
            const changed = postponeSegment(segment, options);
            if (changed === null) return segment;
            count++;
            return changed;
        });
        return `<!--SR:${segments.join("!")}-->`;
    });
    return { text: newText, count };
}
