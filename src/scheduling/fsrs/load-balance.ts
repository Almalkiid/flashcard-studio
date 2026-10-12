import type { Moment } from "moment";
import { get_fuzz_range as getFuzzRange } from "ts-fsrs";

import { TICKS_PER_DAY } from "src/data/formats";
import { type DueDateHistogram, dueDayKey } from "src/scheduling/due-histogram";

/** Easy days remain possible, so selecting every weekday still yields a valid weighted pick. */
export const EASY_DAY_WEIGHT = 0.1;

export interface FsrsLoadBalanceOptions {
    targetInterval: number;
    elapsedDays: number;
    maximumInterval: number;
    histogram: DueDateHistogram;
    now: Moment;
    seed: string;
    easyDays: readonly number[];
    /** The answered card still occupies this bucket until its new schedule is saved. */
    currentDueUnix?: number;
}

/** A small deterministic number in [0, 1), derived from the card's stable fuzz seed. */
function seedFraction(seed: string): number {
    let hash = 2_166_136_261;
    for (let index = 0; index < seed.length; index++) {
        hash = Math.imul(hash ^ seed.charCodeAt(index), 16_777_619);
    }
    return (hash >>> 0) / 4_294_967_296;
}

/**
 * Picks one whole-day FSRS interval from ts-fsrs's own fuzz window. Quiet days receive inverse-square weights;
 * selected easy weekdays receive a small, nonzero multiplier. The histogram is read only.
 */
export function pickFsrsBalancedInterval(options: FsrsLoadBalanceOptions): number {
    if (options.targetInterval < 2.5) return Math.round(options.targetInterval);

    const { min_ivl: minimumInterval, max_ivl: maximumInterval } = getFuzzRange(
        options.targetInterval,
        options.elapsedDays,
        options.maximumInterval,
    );
    if (minimumInterval === maximumInterval) return minimumInterval;

    const oldDay =
        options.currentDueUnix === undefined
            ? undefined
            : dueDayKey(options.currentDueUnix, options.now.valueOf());
    const candidates = Array.from(
        { length: maximumInterval - minimumInterval + 1 },
        (_, offset) => {
            const interval = minimumInterval + offset;
            const dueUnix = options.now.valueOf() + interval * TICKS_PER_DAY;
            const day = dueDayKey(dueUnix, options.now.valueOf());
            const load = Math.max(0, (options.histogram.get(day) ?? 0) - (day === oldDay ? 1 : 0));
            const easy = options.easyDays.includes(new Date(dueUnix).getDay());
            return { interval, weight: (easy ? EASY_DAY_WEIGHT : 1) / (load + 1) ** 2 };
        },
    );
    const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let threshold = seedFraction(options.seed) * total;
    for (const candidate of candidates) {
        threshold -= candidate.weight;
        if (threshold < 0) return candidate.interval;
    }
    return candidates[candidates.length - 1].interval;
}
