import { get_fuzz_range as getFuzzRange } from "ts-fsrs";

import { DueDateHistogram } from "src/scheduling/due-histogram";
import { pickFsrsBalancedInterval } from "src/scheduling/fsrs/load-balance";
import { moment } from "src/utils/moment-en";

const NOW = moment("2023-09-06T00:00:00.000Z");
const BASE = {
    targetInterval: 40,
    elapsedDays: 10,
    maximumInterval: 36525,
    histogram: new DueDateHistogram(),
    now: NOW,
    easyDays: [] as number[],
};

function picks(overrides: Partial<typeof BASE> = {}, count = 1000): number[] {
    return Array.from({ length: count }, (_, index) =>
        pickFsrsBalancedInterval({ ...BASE, ...overrides, seed: `card-${index}` }),
    );
}

test("a busy day is selected far less often than quiet days", () => {
    const histogram = new DueDateHistogram({ 40: 100 });
    const selected = picks({ histogram });
    const busy = selected.filter((interval) => interval === 40).length;
    const quiet = selected.filter((interval) => interval === 39).length;

    expect(busy).toBeLessThan(quiet / 20);
});

test("an easy weekday is avoided when other days are available", () => {
    // 2023-10-16, forty days after NOW, is Monday (1).
    const selected = picks({ easyDays: [1] });
    const monday = selected.filter((interval) => interval === 40).length;
    const saturday = selected.filter((interval) => interval === 38).length;

    expect(monday).toBeLessThan(saturday / 5);
});

test("every pick stays in ts-fsrs's fuzz window", () => {
    const { min_ivl: minimumInterval, max_ivl: maximumInterval } = getFuzzRange(40, 10, 36525);

    for (const interval of picks({}, 200)) {
        expect(interval).toBeGreaterThanOrEqual(minimumInterval);
        expect(interval).toBeLessThanOrEqual(maximumInterval);
    }
});
