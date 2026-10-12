import type { Moment } from "moment";

import { IDateProvider, LiveDateProvider, StaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

// P3-R6: a schedule due on a calendar date is due from the start of the study day that date names. The providers keep
// the end of today's date (the first instant of the next date) until the study day turns, so asking costs no moment.

const FOUR_AM = { hour: 4, minute: 0, second: 0 };

function local(text: string): Moment {
    return moment(text, "YYYY-MM-DD HH:mm");
}

const providers: [string, (at: string) => IDateProvider][] = [
    ["static", (at) => new StaticDateProvider(local(at))],
    [
        "live",
        (at) => {
            jest.useFakeTimers().setSystemTime(local(at).toDate());
            return new LiveDateProvider();
        },
    ],
];

afterEach(() => {
    jest.useRealTimers();
});

describe.each(providers)("%s provider", (_name, make) => {
    test("nowMs is the current instant", () => {
        const provider = make("2023-09-06 13:45");
        expect(provider.nowMs).toBe(local("2023-09-06 13:45").valueOf());
        expect(provider.nowMs).toBe(provider.now.valueOf());
    });

    test("with a midnight boundary today ends at the next midnight", () => {
        const provider = make("2023-09-06 13:45");
        expect(provider.todayEndMs).toBe(local("2023-09-07 00:00").valueOf());
    });

    test("before a 04:00 boundary today is still yesterday, so it ends at this morning's midnight", () => {
        const provider = make("2023-09-07 01:00");
        provider.setDayBoundary(FOUR_AM);
        expect(provider.todayEndMs).toBe(local("2023-09-07 00:00").valueOf());
    });

    test("changing the boundary is seen at once", () => {
        const provider = make("2023-09-07 01:00");
        expect(provider.todayEndMs).toBe(local("2023-09-08 00:00").valueOf());
        provider.setDayBoundary(FOUR_AM);
        expect(provider.todayEndMs).toBe(local("2023-09-07 00:00").valueOf());
        provider.setDayBoundary(null);
        expect(provider.todayEndMs).toBe(local("2023-09-08 00:00").valueOf());
    });
});

describe("the live provider", () => {
    test("moves on when the study day turns, and not before", () => {
        jest.useFakeTimers().setSystemTime(local("2023-09-07 03:59").toDate());
        const provider = new LiveDateProvider();
        provider.setDayBoundary(FOUR_AM);
        expect(provider.todayEndMs).toBe(local("2023-09-07 00:00").valueOf());

        jest.setSystemTime(local("2023-09-07 04:00").toDate());
        expect(provider.todayEndMs).toBe(local("2023-09-08 00:00").valueOf());

        jest.setSystemTime(local("2023-09-08 03:00").toDate());
        expect(provider.todayEndMs).toBe(local("2023-09-08 00:00").valueOf());
    });

    test("reads the time without making a moment once today's end is known", () => {
        jest.useFakeTimers().setSystemTime(local("2023-09-06 12:00").toDate());
        const provider = new LiveDateProvider();
        expect(provider.todayEndMs).toBe(local("2023-09-07 00:00").valueOf());

        const now = jest.spyOn(provider, "now", "get");
        for (let i = 0; i < 1000; i++) {
            expect(provider.todayEndMs).toBe(local("2023-09-07 00:00").valueOf());
        }
        expect(provider.nowMs).toBe(Date.now());
        expect(now).not.toHaveBeenCalled();
    });
});

describe("a static provider whose now is replaced, as the test helpers do", () => {
    test("follows the new now", () => {
        const provider = new StaticDateProvider(local("2023-09-06 12:00"));
        expect(provider.todayEndMs).toBe(local("2023-09-07 00:00").valueOf());
        Object.defineProperty(provider, "now", {
            get: () => local("2023-09-09 12:00"),
            configurable: true,
        });
        expect(provider.nowMs).toBe(local("2023-09-09 12:00").valueOf());
        expect(provider.todayEndMs).toBe(local("2023-09-10 00:00").valueOf());
    });
});
