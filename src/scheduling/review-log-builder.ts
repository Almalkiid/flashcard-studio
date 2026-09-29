import { State } from "ts-fsrs";

import { TICKS_PER_DAY } from "src/data/constants";
import { Card } from "src/data/data-structures/card/card";
import { Rating, ReviewKind, ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";

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

function toKind(
    rating: Rating,
    oldSchedule: RepItemScheduleInfo | null,
    cram: boolean,
): ReviewKind {
    if (cram) return 3;
    if (rating === 0) return 4;
    if (oldSchedule === null) return 0;
    if (oldSchedule instanceof RepItemScheduleInfoFsrs) {
        if (oldSchedule.state === State.Review) return 1;
        if (oldSchedule.state === State.Relearning) return 2;
        return 0;
    }
    return 1;
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
    oldSchedule: RepItemScheduleInfo | null,
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
        ivl: newSchedule
            ? round(Math.max(0, (newSchedule.dueDateAsUnix - nowMs) / TICKS_PER_DAY), 4)
            : 0,
        li: oldSchedule ? oldSchedule.interval : 0,
        ms: Math.min(Math.max(0, Math.round(durationMs)), MAX_ANSWER_TIME_MS),
        dk: card.question.topicPathList?.list[0]?.path.join("/") ?? "",
        f: card.question.note?.filePath ?? "",
    };
    if (oldSchedule === null && rating !== 0 && !cram) entry.n = 1;
    if (!cram && newSchedule instanceof RepItemScheduleInfoFsrs) {
        entry.s = round(newSchedule.stability, 2);
        entry.d = round(newSchedule.difficulty, 2);
    }
    return entry;
}
