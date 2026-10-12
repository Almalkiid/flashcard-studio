import { t } from "src/lang/translate";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { globalDateProvider } from "src/utils/clock";

/**
 * An interval in days as text: days below a month, months with one decimal below a year, then years with one
 * decimal ("27 day(s)", "1.3 month(s)", "2.7 year(s)"; "27d", "1.3m", "2.7y" on a phone). No interval reads "New".
 */
export function textInterval(interval: number | null | undefined, isMobile: boolean): string {
    if (interval == null) return t("NEW");

    const months = Math.round(interval / 3.04375) / 10;
    const years = Math.round(interval / 36.525) / 10;
    const unit = months < 1 ? "DAYS" : years < 1 ? "MONTHS" : "YEARS";
    const shown = months < 1 ? interval : years < 1 ? months : years;
    return t(`${unit}_STR_IVL${isMobile ? "_MOBILE" : ""}`, { interval: shown });
}

/**
 * What an answer button says about the schedule it leads to. A day or more reads as `textInterval`. Less than a day is
 * a learning step, counted from now in minutes below an hour and in hours after (a step of ten hours reads "10 hr",
 * never days): "10 min" ("10m" on a phone), "2 hr" ("2h"). An SM-2 card has no steps, only whole days, so its answer
 * of less than a day (Again) that is already due reads "Today": the card comes back later in this session.
 */
export function formatScheduleInterval(
    schedule: ScheduleState | null | undefined,
    isMobile: boolean,
): string {
    if (!schedule || !(schedule.interval < 1) || !schedule.dueDate) {
        return textInterval(schedule?.interval, isMobile);
    }

    const untilDue = Math.max(0, schedule.dueDateAsUnix - globalDateProvider.now.valueOf());
    const sm2 = schedule.algorithmType === SchedulerKind.SM2;
    if (sm2 && !untilDue) return t("TODAY");

    const minutes = Math.max(1, Math.ceil(untilDue / 60_000));
    if (minutes >= 60) {
        const hours = Math.ceil(minutes / 60);
        return isMobile ? `${hours}h` : `${hours} hr`;
    }
    return isMobile ? `${minutes}m` : `${minutes} min`;
}
