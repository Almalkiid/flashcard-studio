import "moment/locale/ar";

import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";
import { CommentParser } from "src/utils/comment-parser";
import { LiveDateProvider, moment, setupStaticDateProvider } from "src/utils/dates";

// Obsidian sets its shared moment's locale to the app language, and the Arabic locale formats with Arabic-Indic
// digits. Dates the plugin writes into notes, or compares against stored text, must not depend on that language.
describe("dates are locale independent when Obsidian runs in Arabic", () => {
    beforeEach(() => {
        moment.locale("ar");
    });

    afterEach(() => {
        moment.locale("en");
    });

    test("the placeholder of an unreviewed sibling still reads as a new card", () => {
        setupStaticDateProvider("2023-09-06");
        expect(CommentParser.parseMultiScheduleComment("!2000-01-01,1,250")).toEqual([null]);
    });

    test("today formats with Latin digits", () => {
        expect(new LiveDateProvider().today.format("YYYY-MM-DD")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test("SM-2 schedule comments use Latin digits", () => {
        setupStaticDateProvider("2023-09-06");
        const schedule = RepItemScheduleInfoOsr.fromDueDateStr("2023-10-06", 25, 263);
        expect(schedule.formatScheduleAsSRHtmlComment()).toBe("!2023-10-06,25,263");
    });
});
