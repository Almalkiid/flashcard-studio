import { LiveDateProvider } from "src/utils/dates";

// #1423: a day boundary such as 03:00:00 was ignored, because it was only applied when the hour, minute
// and second were all non-zero.
describe("LiveDateProvider day boundary", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    function todayAt(hour: number, minute: number, boundary: [number, number, number] | null) {
        jest.useFakeTimers().setSystemTime(new Date(2026, 8, 29, hour, minute));
        const provider = new LiveDateProvider();
        provider.setDayBoundary(
            boundary ? { hour: boundary[0], minute: boundary[1], second: boundary[2] } : null,
        );
        return provider.today.format("YYYY-MM-DD");
    }

    test.each([
        [1, 0, [3, 0, 0], "2026-09-28"],
        [1, 0, [2, 30, 0], "2026-09-28"],
        [1, 0, [0, 30, 0], "2026-09-29"],
        [3, 0, [3, 0, 0], "2026-09-29"],
        [23, 0, [3, 0, 0], "2026-09-29"],
        [0, 10, [0, 0, 0], "2026-09-29"],
        [0, 10, null, "2026-09-29"],
        [1, 0, [2, 30, 15], "2026-09-28"],
    ])(
        "at %p:%p with boundary %p, today is %p",
        (
            hour: number,
            minute: number,
            boundary: [number, number, number] | null,
            expected: string,
        ) => {
            expect(todayAt(hour, minute, boundary)).toBe(expected);
        },
    );
});
