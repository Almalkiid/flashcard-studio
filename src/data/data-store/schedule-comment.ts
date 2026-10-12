import { MULTI_SCHEDULING_EXTRACTOR } from "src/data/formats";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { CommentParser } from "src/utils/schedule-comment";

// The schedule-comment format shared with the Spaced Repetition plugin, kept so existing schedules carry over.
/**
 * The text without its `<!--SR:...-->` comments. A comment is cut out together with anything up to the last `-->` on
 * its line; one that runs over two lines, or holds nothing, is left alone.
 */
export function withoutScheduleComments(text: string): string {
    return text.replace(/<!--SR:.+-->/g, "");
}

/**
 * The schedules in the first comment of a text, one per card in the order of the cards; null where a card has none.
 * A text with no comment but with `!date,interval,ease` pieces (the oldest note format) gives one schedule for each
 * piece that is a schedule.
 */
export function readSchedules(text: string): ScheduleState[] {
    const body = /<!--SR:(.+?)-->/.exec(text)?.[1];
    if (body) return CommentParser.parseMultiScheduleComment(body);

    const found: ScheduleState[] = [];
    for (const [, due, days, ease] of text.matchAll(MULTI_SCHEDULING_EXTRACTOR)) {
        const schedule = CommentParser.parseSM2Schedule(due, parseFloat(days), parseInt(ease));
        if (schedule !== null) found.push(schedule);
    }
    return found;
}
