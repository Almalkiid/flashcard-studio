const MINUTES_PER_DAY = 24 * 60;

/**
 * Formats a duration given in days compactly: `<1m`, `10m`, `3h`, `4d`, `2.5mo`, `1.2y`.
 */
export function formatIntervalCompact(days: number): string {
    if (!Number.isFinite(days) || days <= 0) return "<1m";

    const minutes = days * MINUTES_PER_DAY;
    if (minutes < 1) return "<1m";
    if (minutes < 60) return `${Math.round(minutes)}m`;
    if (days < 1) return `${Math.round(minutes / 60)}h`;
    if (days < 30.4375) return `${Math.round(days)}d`;
    if (days < 365.25) return `${trimDecimal(days / 30.4375)}mo`;
    return `${trimDecimal(days / 365.25)}y`;
}

/**
 * Formats milliseconds as seconds with one decimal below 10 s, e.g. `4.2s`, `12s`, `1m 5s`.
 */
export function formatAnswerTime(ms: number): string {
    const seconds = Math.max(0, ms) / 1000;
    if (seconds < 10) return `${trimDecimal(seconds)}s`;
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

function trimDecimal(value: number): string {
    return (Math.round(value * 10) / 10).toString();
}
