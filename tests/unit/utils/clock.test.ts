import "moment/locale/ar";

import {
    DateUtil,
    formatDate,
    formatDateWithMoment,
    globalDateProvider,
    IDateProvider,
    LiveDateProvider,
    setupStaticDateProvider,
    setupStaticDateProvider20230906,
    setupStaticDateProviderOriginDatePlusDays,
    StaticDateProvider,
} from "src/utils/clock";
import { moment } from "src/utils/moment-en";

// Nothing in this file reads the wall clock: every "now" is pinned, so a result cannot depend on the weekday, the day
// of the month or the hour the suite runs. (The inherited test compared against the wall clock and failed on Sundays,
// on the 1st of a month and on 1 January.)

const STAMP = "YYYY-MM-DD HH:mm:ss.SSS";

/** The provider's `today`, as local midnight text. */
function todayOf(provider: IDateProvider): string {
    return provider.today.format(STAMP);
}

function midnight(day: string): string {
    return `${day} 00:00:00.000`;
}

function boundaryOf(text: string) {
    const [hour, minute, second] = text.split(":").map(Number);
    return { hour, minute, second };
}

/** Both providers must agree on the study day, so each case runs against both. */
const providers: [string, (at: string, boundary: string | null) => IDateProvider][] = [
    [
        "static",
        (at, boundary) => {
            const provider = new StaticDateProvider(moment(at));
            provider.setDayBoundary(boundary === null ? null : boundaryOf(boundary));
            return provider;
        },
    ],
    [
        "live",
        (at, boundary) => {
            jest.useFakeTimers().setSystemTime(new Date(at.replace(" ", "T")));
            const provider = new LiveDateProvider();
            provider.setDayBoundary(boundary === null ? null : boundaryOf(boundary));
            return provider;
        },
    ],
];

// Importing the Arabic locale file makes Arabic the app language; start from English
beforeAll(() => {
    moment.locale("en");
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe.each(providers)("study day of the %s provider", (_name, make) => {
    // [what the day is, the day, the day before it]
    const days = [
        ["a Sunday", "2026-10-11", "2026-10-10"],
        ["a Monday", "2026-10-12", "2026-10-11"],
        ["the 1st of a month", "2026-10-01", "2026-09-30"],
        ["1 January", "2027-01-01", "2026-12-31"],
    ];
    const times = [
        "00:00:00",
        "03:59:59",
        "04:00:00",
        "12:00:00",
        "22:59:59",
        "23:00:00",
        "23:59:59",
    ];
    const boundaries = ["00:00:00", "04:00:00", "23:00:00"];

    // A day starts AT its boundary instant, so the clock text is compared with the boundary text ("HH:MM:SS" sorts as time)
    const cases = days.flatMap(([label, day, before]) =>
        boundaries.flatMap((boundary) =>
            times.map((time) => [label, time, boundary, day, time >= boundary ? day : before]),
        ),
    );

    test.each(cases)(
        "on %s at %s with days starting at %s (%s), today is %s",
        (_label, time, boundary, day, expected) => {
            expect(todayOf(make(`${day} ${time}`, boundary))).toBe(midnight(expected));
        },
    );

    test.each([
        ["2023-09-06 03:59:59", "04:00:00", "2023-09-05"],
        ["2023-09-06 04:00:00", "04:00:00", "2023-09-06"],
        ["2023-09-06 00:00:00", "04:00:00", "2023-09-05"],
        ["2023-09-06 23:59:59", "04:00:00", "2023-09-06"],
        ["2023-09-01 02:00:00", "04:00:00", "2023-08-31"],
        ["2023-01-01 02:00:00", "04:00:00", "2022-12-31"],
        ["2023-09-06 00:29:59", "00:30:00", "2023-09-05"],
        ["2023-09-06 00:30:00", "00:30:00", "2023-09-06"],
        ["2023-09-06 12:00:00", "23:59:59", "2023-09-05"],
        ["2024-03-01 02:00:00", "04:00:00", "2024-02-29"],
        ["2023-09-06 12:00:00", "02:30:15", "2023-09-06"],
        ["2023-09-06 02:30:14", "02:30:15", "2023-09-05"],
    ])("at %s with days starting at %s, today is %s", (at, boundary, expected) => {
        expect(todayOf(make(at, boundary))).toBe(midnight(expected));
    });

    test("without a boundary, today is the calendar day", () => {
        expect(todayOf(make("2023-09-06 00:00:01", null))).toBe(midnight("2023-09-06"));
        expect(todayOf(make("2023-09-06 23:59:59", null))).toBe(midnight("2023-09-06"));
    });

    test("the boundary starts as null and is stored as given", () => {
        const provider = make("2023-09-06 12:00:00", null);
        expect(provider.getDayBoundary()).toBeNull();
        provider.setDayBoundary({ hour: 4, minute: 30, second: 15 });
        expect(provider.getDayBoundary()).toEqual({ hour: 4, minute: 30, second: 15 });
        provider.setDayBoundary(null);
        expect(provider.getDayBoundary()).toBeNull();
    });

    test("every read is a new object the caller may change", () => {
        const provider = make("2023-09-06 12:00:00", "04:00:00");
        provider.today.add(5, "d");
        provider.now.add(5, "d");
        expect(todayOf(provider)).toBe(midnight("2023-09-06"));
        expect(provider.now.format("YYYY-MM-DD HH:mm")).toBe("2023-09-06 12:00");
    });
});

describe("LiveDateProvider", () => {
    test("now is the clock and keeps the time of day", () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-10-11T13:45:10.250"));
        expect(new LiveDateProvider().now.format(STAMP)).toBe("2026-10-11 13:45:10.250");
    });

    test("each read follows the clock", () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-10-11T12:00:00"));
        const provider = new LiveDateProvider();
        expect(todayOf(provider)).toBe(midnight("2026-10-11"));
        jest.setSystemTime(new Date("2026-10-12T12:00:00"));
        expect(todayOf(provider)).toBe(midnight("2026-10-12"));
    });

    test("today and now each read the clock exactly once", () => {
        const clock = jest
            .spyOn(Date, "now")
            .mockReturnValue(new Date("2026-10-11T03:59:59").getTime());
        const provider = new LiveDateProvider();
        provider.setDayBoundary({ hour: 4, minute: 0, second: 0 });
        expect(todayOf(provider)).toBe(midnight("2026-10-10"));
        expect(clock).toHaveBeenCalledTimes(1);
        clock.mockClear();
        void provider.now;
        expect(clock).toHaveBeenCalledTimes(1);
    });

    test("dates are English whatever language the app runs in", () => {
        moment.locale("ar");
        try {
            jest.useFakeTimers().setSystemTime(new Date("2026-10-11T12:00:00"));
            expect(new LiveDateProvider().today.format("YYYY-MM-DD dddd")).toBe(
                "2026-10-11 Sunday",
            );
        } finally {
            moment.locale("en");
        }
    });
});

describe("StaticDateProvider", () => {
    test("now keeps the time of day it was given and today is local midnight", () => {
        const provider = new StaticDateProvider(moment("2023-09-06 14:30:15.500"));
        expect(provider.now.format(STAMP)).toBe("2023-09-06 14:30:15.500");
        expect(todayOf(provider)).toBe(midnight("2023-09-06"));
    });

    test("it keeps a copy: changing the moment it was given changes nothing", () => {
        const given = moment("2023-09-06 14:30");
        const provider = new StaticDateProvider(given);
        given.add(1, "d");
        expect(provider.now.format("YYYY-MM-DD HH:mm")).toBe("2023-09-06 14:30");
        expect(todayOf(provider)).toBe(midnight("2023-09-06"));
    });

    test("fromDateStr reads the stored date formats", () => {
        expect(todayOf(StaticDateProvider.fromDateStr("2023-09-06"))).toBe(midnight("2023-09-06"));
        expect(todayOf(StaticDateProvider.fromDateStr("06-09-2023"))).toBe(midnight("2023-09-06"));
    });

    test("fromDateStr with unreadable text gives an invalid day instead of throwing", () => {
        const provider = StaticDateProvider.fromDateStr("garbage");
        expect(provider.today.isValid()).toBe(false);
        expect(provider.now.isValid()).toBe(false);
    });
});

describe("DateUtil.dateStrToMoment", () => {
    // Non-strict on purpose: notes written by older versions hold these shapes (lenient reading is stored-data behaviour)
    test.each([
        "2023-09-06",
        "06-09-2023",
        "Wed Sep 06 2023",
        "2023-9-6",
        "6-9-2023",
        "20230906",
        "2023/09/06",
        "2023-09-06T10:00:00Z",
        "2023-09-06 14:30",
    ])("reads %j as 6 September 2023 at midnight", (text) => {
        expect(DateUtil.dateStrToMoment(text).format(STAMP)).toBe(midnight("2023-09-06"));
    });

    test.each(["garbage", "", "Sep 6 2023", undefined, null])("%j is an invalid moment", (text) => {
        expect(DateUtil.dateStrToMoment(text).isValid()).toBe(false);
    });

    test("impossible dates become other valid dates, as stored notes already assume", () => {
        expect(DateUtil.dateStrToMoment("2023-13-01").format("YYYY-MM-DD")).toBe("2023-01-20");
        expect(DateUtil.dateStrToMoment("2023-02-30").format("YYYY-MM-DD")).toBe("2030-02-20");
    });

    test("it reads English day and month names whatever language the app runs in", () => {
        moment.locale("ar");
        try {
            expect(DateUtil.dateStrToMoment("Wed Sep 06 2023").format("YYYY-MM-DD")).toBe(
                "2023-09-06",
            );
            expect(DateUtil.dateStrToMoment("2023-09-06").format("YYYY-MM-DD")).toBe("2023-09-06");
        } finally {
            moment.locale("en");
        }
    });
});

describe("DateUtil.strToDayBoundary", () => {
    // The full table is in start-of-day.test.ts; these pin that the date helper reads values older versions saved
    test.each([
        ["04:00:00", { hour: 4, minute: 0, second: 0 }],
        ["4:0:0", { hour: 4, minute: 0, second: 0 }],
        ["04:0:0", { hour: 4, minute: 0, second: 0 }],
        ["4:30:5", { hour: 4, minute: 30, second: 5 }],
        ["004:00:00", { hour: 4, minute: 0, second: 0 }],
        ["04:30", { hour: 4, minute: 30, second: 0 }],
        [" 04:00:00 ", { hour: 4, minute: 0, second: 0 }],
    ])("reads %j", (text, expected) => {
        expect(DateUtil.strToDayBoundary(text)).toEqual(expected);
    });

    test.each(["", "4", "24:00:00", "04:60:00", "0x10:00:00", "4.5:00:00", "+4:00", null, 4])(
        "rejects %j",
        (value) => {
            expect(DateUtil.strToDayBoundary(value as string)).toBeNull();
        },
    );
});

describe("globalDateProvider and the setup helpers", () => {
    test("it starts as a live provider with no boundary", () => {
        expect(globalDateProvider).toBeInstanceOf(LiveDateProvider);
        expect(globalDateProvider.getDayBoundary()).toBeNull();
    });

    test("setupStaticDateProvider20230906 pins 6 September 2023", () => {
        setupStaticDateProvider20230906();
        expect(globalDateProvider).toBeInstanceOf(StaticDateProvider);
        expect(todayOf(globalDateProvider)).toBe(midnight("2023-09-06"));
        expect(globalDateProvider.now.format(STAMP)).toBe(midnight("2023-09-06"));
    });

    test("setupStaticDateProvider pins the given date", () => {
        setupStaticDateProvider("2023-09-10");
        expect(todayOf(globalDateProvider)).toBe(midnight("2023-09-10"));
    });

    test.each([
        [0, "2023-09-06"],
        [1, "2023-09-07"],
        [400, "2024-10-10"],
        [-1, "2023-09-05"],
        [0.5, "2023-09-07"],
    ])("setupStaticDateProviderOriginDatePlusDays(%p) is %s", (days, expected) => {
        setupStaticDateProviderOriginDatePlusDays(days);
        expect(todayOf(globalDateProvider)).toBe(midnight(expected));
    });

    test("each setup replaces the provider, so an earlier boundary is gone", () => {
        setupStaticDateProvider20230906();
        globalDateProvider.setDayBoundary({ hour: 4, minute: 0, second: 0 });
        setupStaticDateProvider20230906();
        expect(globalDateProvider.getDayBoundary()).toBeNull();
    });

    test("a pinned day honours the boundary through the same global", () => {
        setupStaticDateProvider("2023-09-06");
        globalDateProvider.setDayBoundary({ hour: 4, minute: 0, second: 0 });
        expect(todayOf(globalDateProvider)).toBe(midnight("2023-09-05"));
    });
});

describe("formatDate", () => {
    const ticks = Date.UTC(2023, 0, 1); // jest runs with TZ=UTC, so this is also local midnight

    test("three numbers, a Date and a number of milliseconds give the same default text", () => {
        expect(formatDate(2023, 1, 1)).toBe("2023-01-01");
        expect(formatDate(new Date(2023, 0, 1))).toBe("2023-01-01");
        expect(formatDate(ticks)).toBe("2023-01-01");
    });

    test("the format is honoured in every form", () => {
        expect(formatDate(2023, 1, 2, "DD/MM/YYYY")).toBe("02/01/2023");
        expect(formatDate(ticks, "DD/MM/YYYY")).toBe("01/01/2023");
        expect(formatDate(new Date(2023, 0, 1), "DD/MM/YYYY")).toBe("01/01/2023");
        expect(formatDate(ticks, "YYYY-MM-DD")).toBe("2023-01-01");
    });

    test("only the tokens YYYY, MM and DD exist, wherever they occur", () => {
        expect(formatDate(2023, 1, 2, "D/M/YY")).toBe("D/M/YY");
        expect(formatDate(2023, 1, 2, "MMMM")).toBe("0101");
        expect(formatDate(2023, 1, 2, "due: YYYY.MM.DD!")).toBe("due: 2023.01.02!");
        expect(formatDate(2023, 1, 2, "")).toBe("");
    });

    test.each([
        [2020, 2, 29, "2020-02-29"],
        [2023, 13, 32, "2024-02-01"],
        [2023, 2, 30, "2023-03-02"],
        [50, 1, 1, "1950-01-01"],
    ])(
        "year %d, month %d, day %d gives %s (as JavaScript rolls over)",
        (year, month, day, expected) => {
            expect(formatDate(year, month, day)).toBe(expected);
        },
    );

    test.each([
        [0, "1970-01-01"],
        [-1, "1969-12-31"],
        [1672531200000, "2023-01-01"],
    ])("%d milliseconds give %s", (ms, expected) => {
        expect(formatDate(ms)).toBe(expected);
    });

    test.each([null, undefined, "2023-01-01", {}, NaN, new Date(NaN)])(
        "%j gives an empty string",
        (value) => {
            expect(formatDate(value as number)).toBe("");
        },
    );
});

describe("formatDateWithMoment", () => {
    const ticks = Date.UTC(2023, 0, 1);

    test("formats with moment tokens in English", () => {
        expect(formatDateWithMoment(ticks, "DD/MM/YYYY")).toBe("01/01/2023");
        expect(formatDateWithMoment(ticks, "dddd MMMM")).toBe("Sunday January");
    });

    test("it stays English when the app runs in Arabic", () => {
        moment.locale("ar");
        try {
            expect(formatDateWithMoment(ticks, "YYYY-MM-DD dddd")).toBe("2023-01-01 Sunday");
        } finally {
            moment.locale("en");
        }
    });
});
