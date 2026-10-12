import "moment/locale/ar";

import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { LiveDateProvider, setupStaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";
import { CommentParser } from "src/utils/schedule-comment";

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
        const schedule = Sm2State.fromDueDateStr("2023-10-06", 25, 263);
        expect(schedule.formatScheduleAsComment()).toBe("!2023-10-06,25,263");
    });
});
