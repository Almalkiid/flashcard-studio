import { parseCommentMeta } from "src/data/card-meta";
import { withoutScheduleComments } from "src/data/data-store/schedule-comment";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";

import { DataStore } from "./api";
import { golden, settingsWith, setUp } from "./helpers";

interface Row {
    id: string;
    input: string;
    schedules: ({ comment: string; interval: number | null; ease: number } | null)[];
    meta: unknown[];
    removeScheduleInfo: string;
    warnings: number;
}

const rows = golden<Row[]>("comment-read");

const shape = (info: ScheduleState | null) =>
    info === null
        ? null
        : {
              comment: info.formatScheduleAsComment(),
              interval: Number.isNaN(info.interval) ? null : info.interval,
              ease: info.latestEase,
          };

describe.each(rows)("reading a comment: $id", (row) => {
    test("schedules by position, metadata, the text without the comment, and the warnings", () => {
        setUp(settingsWith());
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const store = DataStore.getInstance();
        expect(store.createSchedule(row.input, null).map(shape)).toEqual(row.schedules);
        expect(parseCommentMeta(row.input)).toEqual(row.meta);
        expect(withoutScheduleComments(row.input)).toBe(row.removeScheduleInfo);
        expect(warn.mock.calls.length).toBeGreaterThanOrEqual(row.warnings);
        warn.mockRestore();
    });
});
