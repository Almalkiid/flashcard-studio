/** The time of day at which a new study day starts. */
export interface IDayBoundary {
    hour: number;
    minute: number;
    second: number;
}

const TIME = /^(\d+):(\d+)(?::(\d+))?$/;

/**
 * Reads start-of-day text: hour and minute, with seconds optional ("4:0:0", "04:30", " 23:59:59 "). Each part is
 * one or more digits, so every shape an older version could have saved is read. Null for anything else: not text,
 * hex or fractions, signs, or a part out of range (hour 0-23, minute and second 0-59). It never throws.
 *
 * What a person may type on the settings screen is stricter and lives in settings/validators.ts.
 */
export function parseStartOfDay(text: unknown): IDayBoundary | null {
    if (typeof text !== "string") return null;
    const match = TIME.exec(text.trim());
    if (match === null) return null;
    const [hour, minute, second] = [match[1], match[2], match[3] ?? "0"].map(Number);
    return hour <= 23 && minute <= 59 && second <= 59 ? { hour, minute, second } : null;
}

/**
 * The start of day that is `ms` after midnight, to the whole second. Null when `ms` is not a time of day: negative,
 * 24 hours or more, or not a number.
 */
export function dayBoundaryFromMs(ms: number): IDayBoundary | null {
    if (!(ms >= 0 && ms < 24 * 3600 * 1000)) return null;
    const seconds = Math.floor(ms / 1000);
    return {
        hour: Math.floor(seconds / 3600),
        minute: Math.floor((seconds % 3600) / 60),
        second: seconds % 60,
    };
}

const DAY_MS = 86_400_000;

/**
 * Builds the mapping from an instant to its study day, as a number of days since 1970-01-01. The study day is the
 * local date of the instant, or the one before it when the instant is earlier than that date's start of day (null:
 * midnight). It names the same day as `IDateProvider.today` in clock.ts, also on days when the clocks change, because
 * the start of day is compared as wall-clock time and not subtracted as a duration.
 *
 * This is the fast path for tens of thousands of log entries, in any order: each local date's start of day is worked
 * out once, and Date is the only thing used (clock.ts needs moment, which the optimizer script cannot load). An
 * instant that is not a time gives NaN and changes nothing for the ones after it.
 */
export function makeStudyDayNumberFn(boundary: IDayBoundary | null): (epochMs: number) => number {
    const dates = new Map<number, { day: number; startMs: number }>();

    return (epochMs: number): number => {
        const local = new Date(epochMs);
        const year = local.getFullYear();
        const month = local.getMonth();
        const date = local.getDate();
        const dateKey = (year * 12 + month) * 32 + date;

        let known = dates.get(dateKey);
        if (known === undefined) {
            known = {
                day: Date.UTC(year, month, date) / DAY_MS,
                // Where the clocks skip that time of day it is the first instant after the gap, as for a moment
                startMs:
                    boundary === null
                        ? -Infinity
                        : new Date(
                              year,
                              month,
                              date,
                              boundary.hour,
                              boundary.minute,
                              boundary.second,
                          ).getTime(),
            };
            dates.set(dateKey, known);
        }
        return epochMs < known.startMs ? known.day - 1 : known.day;
    };
}
