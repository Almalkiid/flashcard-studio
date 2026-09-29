/**
 * Day keys (`YYYY-MM-DD`) for the statistics. A day key is the plugin's "study day": the calendar date of a moment
 * after shifting it back by the day boundary setting, so with a 04:00 start an answer at 03:00 belongs to yesterday.
 */

/** Maps an epoch millisecond time to its study day. */
export type DayKeyFn = (epochMs: number) => string;

export const MS_PER_HOUR = 3600 * 1000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

function formatKey(year: number, month: number, day: number): string {
    return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

function utcTimeOf(key: string): number {
    const [year, month, day] = key.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
}

/**
 * @param boundary - The day boundary setting, or null for midnight.
 */
export function boundaryToMs(
    boundary: { hour: number; minute: number; second: number } | null,
): number {
    if (boundary === null) return 0;
    return (boundary.hour * 3600 + boundary.minute * 60 + boundary.second) * 1000;
}

/**
 * Builds the moment to day key mapping in the local time zone. Consecutive calls on the same day skip the date
 * arithmetic, which matters when aggregating tens of thousands of time-sorted log entries.
 *
 * @param boundaryMs - How long after local midnight a new study day starts.
 */
export function makeDayKeyFn(boundaryMs: number): DayKeyFn {
    let cachedStart = 0;
    let cachedEnd = 0;
    let cachedKey = "";

    return (epochMs: number): string => {
        if (epochMs >= cachedStart && epochMs < cachedEnd) return cachedKey;

        const shifted = new Date(epochMs - boundaryMs);
        const year = shifted.getFullYear();
        const month = shifted.getMonth();
        const day = shifted.getDate();
        cachedKey = formatKey(year, month + 1, day);
        cachedStart = new Date(year, month, day).getTime() + boundaryMs;
        cachedEnd = new Date(year, month, day + 1).getTime() + boundaryMs;
        return cachedKey;
    };
}

export function addDays(key: string, days: number): string {
    const date = new Date(utcTimeOf(key) + days * MS_PER_DAY);
    return formatKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** The number of days from `fromKey` to `toKey`; negative when `toKey` is earlier. */
export function diffDays(fromKey: string, toKey: string): number {
    return Math.round((utcTimeOf(toKey) - utcTimeOf(fromKey)) / MS_PER_DAY);
}

/** 0 for Sunday to 6 for Saturday. */
export function weekdayOf(key: string): number {
    return new Date(utcTimeOf(key)).getUTCDay();
}

/** Every day key from `startKey` to `endKey`, inclusive; empty when `endKey` is before `startKey`. */
export function dayKeyRange(startKey: string, endKey: string): string[] {
    const keys: string[] = [];
    const count = diffDays(startKey, endKey);
    for (let i = 0; i <= count; i++) keys.push(addDays(startKey, i));
    return keys;
}
