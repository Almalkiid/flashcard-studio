import type { Moment } from "moment";
import { CardInput, State } from "ts-fsrs";

import { easeToDifficulty } from "src/scheduling/schedule/fsrs-state";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";

/**
 * The ts-fsrs card an SM-2 schedule stands for, for a card reviewed under SM-2 and answered now under FSRS (the
 * algorithm setting changed, or an older version wrote the note).
 *
 * SM-2 keeps no review time, so the last review is placed `interval` days before the due date: a card answered late
 * has waited longer than its interval. The interval (a whole number of days, at least one) is also the stability, the
 * ease becomes the difficulty, and the review count is what an interval that long takes to reach.
 *
 * @param schedule - null (or one without a due date or interval) gives a card due now with an interval of one day.
 * @param now - The instant of the answer.
 */
export function sm2ScheduleToFsrsCard(schedule: ScheduleState | null, now: Moment): CardInput {
    const due = (schedule?.dueDate ?? now).clone();
    const interval = Math.max(1, Math.round(schedule?.interval || 1));
    const lastReview = due.clone().subtract(interval, "days");
    const sinceReview = Math.max(0, now.diff(lastReview, "days"));
    /* eslint-disable camelcase -- ts-fsrs's card fields are snake_case */
    return {
        due: due.toDate(),
        stability: interval,
        difficulty: easeToDifficulty(schedule?.latestEase),
        elapsed_days: sinceReview,
        scheduled_days: interval,
        learning_steps: 0,
        reps: Math.round(Math.log2(interval + 1)),
        lapses: 0,
        state: State.Review,
        last_review: lastReview.toDate(),
    };
    /* eslint-enable camelcase -- the snake_case card fields end here */
}
