import { moment } from "obsidian";

import { t } from "src/lang/helpers";

/**
 * The language tag for numbers and dates: the language Obsidian is set to, not the operating system's.
 */
function localeTag(): string {
    return moment.locale() || "en";
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const cacheKey = `${localeTag()}|${key}`;
    let formatter = formatters.get(cacheKey);
    if (formatter === undefined) {
        formatter = new Intl.DateTimeFormat(localeTag(), options);
        formatters.set(cacheKey, formatter);
    }
    return formatter;
}

/** A local date for a `YYYY-MM-DD` study day key. */
export function dateOfKey(key: string): Date {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
}

/** `29 Sep` */
export function formatDayShort(key: string): string {
    return dateFormatter("short", { day: "numeric", month: "short" }).format(dateOfKey(key));
}

/** `Mon 29 Sep` */
export function formatDayLong(key: string): string {
    return dateFormatter("long", { weekday: "short", day: "numeric", month: "short" }).format(
        dateOfKey(key),
    );
}

/** `Sep` */
export function formatMonthShort(month: number): string {
    return dateFormatter("month", { month: "short" }).format(new Date(2000, month, 1));
}

/** `Mon`; 0 is Sunday. */
export function formatWeekdayShort(weekday: number): string {
    // 2023-01-01 was a Sunday
    return dateFormatter("weekday", { weekday: "short" }).format(new Date(2023, 0, 1 + weekday));
}

/** `2026-09-29` and `2026-09-30` map to `Sep 2026` for a month bucket. */
export function formatMonthYear(key: string): string {
    return dateFormatter("monthyear", { month: "short", year: "numeric" }).format(dateOfKey(key));
}

export function formatCount(value: number): string {
    return value.toLocaleString(localeTag());
}

/** `87%`, or a dash when there is no rate. */
export function formatPercent(rate: number | null): string {
    return rate === null ? "-" : `${Math.round(rate * 100)}%`;
}

/** `1 review`, `12 reviews`. */
export function reviewsLabel(count: number): string {
    return count === 1
        ? t("STATS_REVIEWS_ONE")
        : t("STATS_REVIEWS_MANY", { count: formatCount(count) });
}

/** `1 day`, `12 days`. */
export function daysLabel(count: number): string {
    return count === 1 ? t("STATS_DAY_ONE") : t("STATS_DAY_MANY", { count: formatCount(count) });
}

/** `45 min` or `1 h 05 min`; anything under a minute rounds up to `1 min`. */
export function formatDuration(ms: number): string {
    const totalMinutes = ms <= 0 ? 0 : Math.max(1, Math.round(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return t("STATS_DURATION_MIN", { minutes });
    return t("STATS_DURATION_HOUR_MIN", { hours, minutes: String(minutes).padStart(2, "0") });
}

/** `Sep 29, 2:05 PM`, with the year only when it is not the current one. */
export function formatDateTimeShort(epochMs: number): string {
    const date = new Date(epochMs);
    const otherYear = date.getFullYear() !== new Date().getFullYear();
    return dateFormatter(otherYear ? "datetime-year" : "datetime", {
        month: "short",
        day: "numeric",
        year: otherYear ? "numeric" : undefined,
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

/** `29 Sep 2026` in the user's language. */
export function formatDate(epochMs: number): string {
    return dateFormatter("date", { dateStyle: "medium" }).format(new Date(epochMs));
}

/** `0.4`, `12`, `130`: at most one decimal, none for larger numbers. */
export function formatCompactNumber(value: number): string {
    if (value >= 100) return formatCount(Math.round(value));
    return formatCount(Math.round(value * 10) / 10);
}
