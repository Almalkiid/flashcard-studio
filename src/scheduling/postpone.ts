import { State } from "ts-fsrs";

import { PREFERRED_DATE_FORMAT } from "src/data/constants";
import { Card } from "src/data/data-structures/card/card";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { FSRS_COMMENT_PREFIX } from "src/scheduling/algorithms/fsrs/fsrs-helpers";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import { CommentParser } from "src/utils/comment-parser";
import { formatDate } from "src/utils/dates";

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
 * overdue is not left overdue by a short postponement.
 */
export function postponedDueMs(dueMs: number, options: PostponeOptions): number {
    return addDays(Math.max(dueMs, options.todayStartMs), options.days);
}

/**
 * Whether a schedule is a review card that is due today or overdue. Cards being learned, new cards and cards due
 * on a later day are left alone.
 */
export function isPostponable(schedule: RepItemScheduleInfo | null, todayStartMs: number): boolean {
    if (schedule === null) return false;
    if (schedule instanceof RepItemScheduleInfoFsrs && schedule.state !== State.Review) {
        return false;
    }
    return schedule.dueDateAsUnix < addDays(todayStartMs, 1);
}

/**
 * The cards a postponement would move, each counted once even when it sits in several decks.
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
 * @returns The new text and how many cards were postponed.
 */
export function postponeInText(
    text: string,
    options: PostponeOptions,
): { text: string; count: number } {
    let count = 0;
    const newText = text.replace(/<!--SR:(.+?)-->/g, (_match: string, comment: string) => {
        const segments = comment.split("!").map((segment) => {
            const changed = postponeSegment(segment, options);
            if (changed === null) return segment;
            count++;
            return changed;
        });
        return `<!--SR:${segments.join("!")}-->`;
    });
    return { text: newText, count };
}
