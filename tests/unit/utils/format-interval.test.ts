import { formatAnswerTime, formatIntervalCompact } from "src/utils/format-interval";

describe("formatIntervalCompact", () => {
    test.each([
        [0, "<1m"],
        [-1, "<1m"],
        [Number.NaN, "<1m"],
        [0.0005, "<1m"],
        [10 / 1440, "10m"],
        [59.4 / 1440, "59m"],
        [3 / 24, "3h"],
        [1, "1d"],
        [4.4, "4d"],
        [30, "30d"],
        [76, "2.5mo"],
        [400, "1.1y"],
    ])("%p days -> %s", (days: number, expected: string) => {
        expect(formatIntervalCompact(days)).toBe(expected);
    });
});

describe("formatAnswerTime", () => {
    test.each([
        [-5, "0s"],
        [4200, "4.2s"],
        [12400, "12s"],
        [65000, "1m 5s"],
    ])("%p ms -> %s", (ms: number, expected: string) => {
        expect(formatAnswerTime(ms)).toBe(expected);
    });
});
