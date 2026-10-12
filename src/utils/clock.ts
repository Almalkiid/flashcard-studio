import type { Moment } from "moment";

import { ALLOWED_DATE_FORMATS, PREFERRED_DATE_FORMAT } from "src/data/formats";
import { moment } from "src/utils/moment-en";
import { type IDayBoundary, makeStudyDayNumberFn, parseStartOfDay } from "src/utils/start-of-day";

export type { IDayBoundary };

/** The seam through which the plugin reads time, so tests can pin it. */
export interface IDateProvider {
    /** The current instant. */
    get now(): Moment;
    /** The current instant in milliseconds, the same as `now` without making a moment. */
    get nowMs(): number;
    /** Local midnight of the current study day (the day before until the day boundary has passed). */
    get today(): Moment;
    /**
     * The end of the date `today` names: the first instant of the next calendar date. Something due on a calendar date
     * (an SM-2 card) is due when its date starts before this. Kept until the study day turns, so it costs no moment.
     */
    get todayEndMs(): number;
    getDayBoundary(): IDayBoundary | null;
    setDayBoundary(dayBoundary: IDayBoundary | null): void;
}

/**
 * The start of the study day that `now` falls in (local midnight, or the first instant of the day where the clocks
 * skip midnight). The boundary is compared as wall-clock time of day, never subtracted as a duration, so the answer
 * stays right on days when the clocks change; before it, the answer is the start of the previous calendar day.
 */
function studyDayStart(now: Moment, boundary: IDayBoundary | null): Moment {
    if (boundary !== null && now.isBefore(now.clone().startOf("day").set(boundary))) {
        return now.clone().subtract(1, "day").startOf("day");
    }
    return now.clone().startOf("day");
}

abstract class DayBoundaryProvider implements IDateProvider {
    private dayBoundary: IDayBoundary | null = null;
    /** `todayEndMs` and the study day it holds for: from `fromMs` up to, not including, `untilMs`. */
    private todayEnd: { fromMs: number; untilMs: number; endMs: number } | null = null;

    abstract get now(): Moment;

    get nowMs(): number {
        return this.now.valueOf();
    }

    get today(): Moment {
        return studyDayStart(this.now, this.dayBoundary);
    }

    get todayEndMs(): number {
        const nowMs = this.nowMs;
        const known = this.todayEnd;
        if (known !== null && nowMs >= known.fromMs && nowMs < known.untilMs) return known.endMs;

        const today = studyDayStart(moment(nowMs), this.dayBoundary);
        const next = today.clone().add(1, "day").startOf("day");
        const boundary = this.dayBoundary;
        this.todayEnd = {
            fromMs: boundary === null ? today.valueOf() : today.clone().set(boundary).valueOf(),
            untilMs: boundary === null ? next.valueOf() : next.clone().set(boundary).valueOf(),
            endMs: next.valueOf(),
        };
        return this.todayEnd.endMs;
    }

    getDayBoundary(): IDayBoundary | null {
        return this.dayBoundary;
    }

    setDayBoundary(dayBoundary: IDayBoundary | null): void {
        this.dayBoundary = dayBoundary;
        this.todayEnd = null;
    }
}

/** Reads the real clock, once per call. */
export class LiveDateProvider extends DayBoundaryProvider {
    get now(): Moment {
        return moment();
    }

    get nowMs(): number {
        return Date.now();
    }
}

/** A clock stopped at the moment it was given (copied, so changing that moment later changes nothing). */
export class StaticDateProvider extends DayBoundaryProvider {
    private readonly instant: Moment;

    constructor(instant: Moment) {
        super();
        this.instant = instant.clone();
    }

    get now(): Moment {
        return this.instant.clone();
    }

    static fromDateStr(str: string): StaticDateProvider {
        return new StaticDateProvider(DateUtil.dateStrToMoment(str));
    }
}

export class DateUtil {
    /**
     * Reads one of ALLOWED_DATE_FORMATS as local midnight; text that matches none gives an invalid moment.
     * Parsing is deliberately NOT strict: notes written by older versions rely on it (so "2023-13-01" is read as a
     * different, valid date). English is passed explicitly so the app language cannot change what a day name means.
     */
    static dateStrToMoment(str: string): Moment {
        return moment(str, ALLOWED_DATE_FORMATS, "en");
    }

    /** Reads start-of-day text, including shapes older versions saved; null when it is not one. Never throws. */
    static strToDayBoundary(str: unknown): IDayBoundary | null {
        return parseStartOfDay(str);
    }
}

export let globalDateProvider: IDateProvider = new LiveDateProvider();

/** Test support: stops the global clock at midnight of `dateStr`. */
export function setupStaticDateProvider(dateStr: string): void {
    globalDateProvider = StaticDateProvider.fromDateStr(dateStr);
}

const ORIGIN_DATE = "2023-09-06";

/** Test support: stops the global clock `days` after 2023-09-06 (negative reaches back). */
export function setupStaticDateProviderOriginDatePlusDays(days: number): void {
    globalDateProvider = new StaticDateProvider(
        DateUtil.dateStrToMoment(ORIGIN_DATE).add(days, "d"),
    );
}

/** Test support: stops the global clock at 2023-09-06. */
export function setupStaticDateProvider20230906(): void {
    setupStaticDateProvider(ORIGIN_DATE);
}

const DAY_MS = 86_400_000;

/** The local date of an instant as days since 1970-01-01: the study day function for a day that starts at midnight. */
const localDate = makeStudyDayNumberFn(null);

/** A date whose midnight the clocks skip starts at most this long after midnight: up to 3 hours. */
const LONGEST_SKIP_MS = 3 * 3_600_000;

/**
 * An instant as the wall clock reads it: the local date and time laid out as if the zone had no clock changes. The
 * difference of two such values is a whole number of days between two midnights, also across the night the clocks
 * change (when the real difference is 23 or 25 hours). The first instant of a date reads as that date's midnight, also
 * where the clocks skip midnight (Beirut, Cairo, Santiago, Havana, the Azores: the date then starts at 01:00).
 */
export function wallClockMs(ms: number): number {
    const wall = ms - new Date(ms).getTimezoneOffset() * 60_000;
    const sinceMidnight = wall - Math.floor(wall / DAY_MS) * DAY_MS;
    // Only a time shortly after midnight can be the start of a date whose midnight does not exist
    if (
        sinceMidnight > 0 &&
        sinceMidnight <= LONGEST_SKIP_MS &&
        localDate(ms) > localDate(ms - 1)
    ) {
        return localDate(ms) * DAY_MS;
    }
    return wall;
}

/**
 * Formats with the tokens YYYY, MM and DD only (zero padded, local time), wherever they occur; the default is
 * YYYY-MM-DD. Takes year, month (1-12) and day, or a Date, or milliseconds since the epoch; anything that is not a
 * valid date gives "".
 */
export function formatDate(year: number, month: number, day: number, format?: string): string;
export function formatDate(date: Date, format?: string): string;
export function formatDate(ticks: number, format?: string): string;
export function formatDate(
    first: number | Date,
    second?: number | string,
    day?: number,
    format?: string,
): string {
    const byParts = typeof second === "number";
    const date = byParts
        ? new Date(first as number, second - 1, day)
        : typeof first === "number"
          ? new Date(first)
          : first;
    const pattern = byParts ? format : second;

    const time = date?.getTime?.();
    if (typeof time !== "number" || Number.isNaN(time)) return "";

    const pad = (value: number, width: number) => String(value).padStart(width, "0");
    return (pattern ?? PREFERRED_DATE_FORMAT).replace(/YYYY|MM|DD/g, (token) =>
        token === "YYYY"
            ? pad(date.getFullYear(), 4)
            : pad(token === "MM" ? date.getMonth() + 1 : date.getDate(), 2),
    );
}

/** Formats a time with moment tokens, in English. */
export function formatDateWithMoment(ticks: number, format: string): string {
    return moment(ticks).format(format);
}
