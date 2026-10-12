import { State } from "ts-fsrs";

import { Card } from "src/data/data-structures/card/flashcard";
import { TICKS_PER_DAY } from "src/data/formats";
import { Rating, ReviewKind, ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { FsrsState, isReviewCard } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";

/** Anki caps the recorded answer time at 60 seconds by default. */
export const MAX_ANSWER_TIME_MS = 60000;

function toRating(response: ReviewResponse): Rating {
    switch (response) {
        case ReviewResponse.Again:
            return 1;
        case ReviewResponse.Hard:
            return 2;
        case ReviewResponse.Good:
            return 3;
        case ReviewResponse.Easy:
            return 4;
        default:
            return 0;
    }
}

function toKind(rating: Rating, oldSchedule: ScheduleState | null, cram: boolean): ReviewKind {
    if (cram) return 3;
    if (rating === 0) return 4;
    if (oldSchedule === null) return 0;
    if (isReviewCard(oldSchedule)) return 1;
    return oldSchedule instanceof FsrsState && oldSchedule.state === State.Relearning ? 2 : 0;
}

function round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

/**
 * Builds the review log entry for one answer. Call it after the card's new schedule has been written, so the card
 * has its id.
 *
 * @param card - The answered card, carrying its new schedule (or its unchanged one in cram mode).
 * @param response - The button pressed.
 * @param oldSchedule - The schedule before the answer, null for a new card.
 * @param durationMs - Time from showing the card to answering it.
 * @param cram - Whether this was a cram answer that did not reschedule.
 * @param nowMs - The time of the answer.
 */
export function buildReviewLogEntry(
    card: Card,
    response: ReviewResponse,
    oldSchedule: ScheduleState | null,
    durationMs: number,
    cram: boolean,
    nowMs: number,
): ReviewLogEntry {
    const rating = toRating(response);
    const newSchedule = card.scheduleInfo;
    const entry: ReviewLogEntry = {
        t: nowMs,
        c: card.meta.id ?? "",
        r: rating,
        k: toKind(rating, oldSchedule, cram),
        // A learning step without a due time has no interval to log
        ivl: newSchedule?.dueDate?.isValid()
            ? round(Math.max(0, (newSchedule.dueDateAsUnix - nowMs) / TICKS_PER_DAY), 4)
            : 0,
        li: oldSchedule ? oldSchedule.interval : 0,
        ms: Math.min(Math.max(0, Math.round(durationMs)), MAX_ANSWER_TIME_MS),
        dk: card.question.topicPathList?.list[0]?.path.join("/") ?? "",
        f: card.question.note?.filePath ?? "",
    };
    // A card reset to FSRS's New state is introduced again by its next answer, so it counts as a new card (D2 #4)
    const isNew =
        oldSchedule === null ||
        (oldSchedule instanceof FsrsState && oldSchedule.state === State.New);
    if (isNew && rating !== 0 && !cram) entry.n = 1;
    if (!cram && newSchedule instanceof FsrsState) {
        entry.s = round(newSchedule.stability, 2);
        entry.d = round(newSchedule.difficulty, 2);
    }
    return entry;
}
