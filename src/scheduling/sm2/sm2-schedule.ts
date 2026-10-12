import { TICKS_PER_DAY } from "src/data/formats";
import type { StudioSettings } from "src/data/settings-model";
import type { DueDateHistogram } from "src/scheduling/due-histogram";
import { ReviewResponse } from "src/scheduling/schedule/review-item";

/**
 * Days either side of an interval that load balancing may move it: 1 up to 21 days, then 5 percent of the interval
 * (at most 3) up to 180 days, then 2.5 percent (at most 7).
 */
function fuzzDays(interval: number): number {
    if (interval <= 21) return 1;
    const [share, cap] = interval <= 180 ? [0.05, 3] : [0.025, 7];
    return Math.min(cap, Math.floor(interval * share));
}

/**
 * The SM-2 step: the next interval (days) and ease after an answer. Pure: the histogram is only read, whoever stores
 * the answer counts it in.
 *
 * @param delayedBeforeReview - Milliseconds the review was late. Only whole days count, and early counts as on time.
 *     The bonus for lateness is half of it for Good and a quarter for Hard.
 * @param dueDateHistogram - With load balancing on, an interval over a week moves to the least busy day nearby.
 */
export function sm2Step(
    response: ReviewResponse,
    originalInterval: number,
    originalEase: number,
    delayedBeforeReview: number,
    settings: StudioSettings,
    dueDateHistogram?: DueDateHistogram,
): { interval: number; ease: number } {
    const lateDays = Math.max(0, Math.floor(delayedBeforeReview / TICKS_PER_DAY));
    const base = Math.max(1, originalInterval);
    const lowerEase = Math.max(130, originalEase - 20);
    let ease = originalEase;
    let interval = base;

    if (response === ReviewResponse.Easy) {
        ease = originalEase + 20;
        interval = (((base + lateDays) * ease) / 100) * settings.easyBonus;
    } else if (response === ReviewResponse.Good) {
        interval = ((base + lateDays / 2) * ease) / 100;
    } else if (response === ReviewResponse.Hard) {
        ease = lowerEase;
        interval = Math.max(1, (base + lateDays / 4) * settings.lapsesIntervalChange);
    } else if (response === ReviewResponse.Again) {
        ease = lowerEase;
        interval = 0;
    }
    // Reset and anything else: the ease stays and so does the interval

    if (settings.loadBalance && dueDateHistogram) {
        interval = Math.round(interval);
        if (interval > 7) {
            const nearby = fuzzDays(interval);
            interval = dueDateHistogram.findLeastUsedIntervalOverRange(interval, nearby);
        }
    }

    const capped = Math.min(interval, settings.maximumInterval);
    return { interval: Math.round(capped * 10) / 10, ease };
}
