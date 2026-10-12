import type { Moment } from "moment";

import { globalDateProvider, setupStaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

/** The instant the golden files were captured at (the suite runs with TZ=UTC). */
export const DEFAULT_CLOCK = "2023-09-06T00:00:00.000Z";

export const iso = (instant: string): Moment => moment(instant);

/** Stops the global clock at this instant, time of day included. */
export function clockAt(instant: string): void {
    setupStaticDateProvider("2023-09-06");
    Object.defineProperty(globalDateProvider, "now", {
        get: () => moment(instant),
        configurable: true,
    });
}
