import { DueDateHistogram } from "src/scheduling/due-histogram";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { sm2Step } from "src/scheduling/sm2/sm2-schedule";

import { loadGolden } from "../golden/load-golden";
import { ids, mismatches } from "../schedule/golden-views";
import { histogramOf, RESPONSE, settingsOf, sm2Golden, Sm2Row } from "./grid";

const golden = loadGolden<{
    halfWidthOfTheSearchWindow: {
        id: string;
        interval: number;
        reachablePlus: number;
        reachableMinus: number;
    }[];
}>("histogram");

const DAY = 86_400_000;

/** One golden row run through the function: delays in the file are in days, the function takes milliseconds. */
function run(
    row: Pick<Sm2Row, "config" | "histogram" | "response" | "interval" | "ease" | "delayDays">,
) {
    return sm2Step(
        RESPONSE[row.response],
        row.interval,
        row.ease,
        row.delayDays * DAY,
        settingsOf(row.config),
        histogramOf(row.histogram),
    );
}

describe("sm2Step against the golden grid", () => {
    test("every one of the 7,817 rows (intervals x eases x delays x responses x settings x histograms)", () => {
        const bad = mismatches(sm2Golden.sm2Step, (row) => ({
            expected: row.out,
            actual: run(row),
        }));
        expect(sm2Golden.sm2Step).toHaveLength(7817);
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("the 24 numbers the inventory prints for the arithmetic (the other 49 cross-checks are texts and settings cases)", () => {
        const printed = sm2Golden.inventoryCrossChecks.filter((row) => row.input?.response);
        const bad = mismatches(printed, (row) => ({
            expected: row.actual,
            actual: run(row.input),
        }));
        expect(sm2Golden.inventoryCrossChecks).toHaveLength(73);
        expect(sm2Golden.inventoryCrossChecks.every((row) => row.matchesInventory)).toBe(true);
        expect(printed).toHaveLength(24);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("the 17 worked examples of the inventory that name their inputs in words", () => {
        const defaults = settingsOf("defaults");
        const production = (
            response: ReviewResponse,
            interval: number,
            ease: number,
            delayDays: number,
            settings = defaults,
        ) => sm2Step(response, interval, ease, delayDays * DAY, settings, new DueDateHistogram());
        const unbalanced = { ...defaults, loadBalance: false };
        const { Easy, Good, Hard } = ReviewResponse;
        expect(production(Good, 10, 250, 1.9).interval).toBe(26);
        expect(production(Good, 10, 250, 3.2).interval).toBe(29);
        expect(production(Hard, 2, 140, 0).ease).toBe(130);
        expect(production(Hard, 2, 130, 0).ease).toBe(130);
        expect(production(Hard, 2, 500, 0).ease).toBe(480);
        expect(production(Hard, 0.4, 250, 0).interval).toBe(1);
        expect(production(Easy, 30000, 300, 0, { ...defaults, maximumInterval: 100 })).toEqual({
            interval: 100,
            ease: 320,
        });
        expect(production(Easy, 10, 250, 0, { ...defaults, easyBonus: 2 }).interval).toBe(54);
        expect(production(Easy, 10, 250, 0, { ...defaults, easyBonus: 1 }).interval).toBe(27);
        expect(
            production(Hard, 10, 250, 0, { ...defaults, lapsesIntervalChange: 1 }).interval,
        ).toBe(10);
        expect(
            production(Hard, 10, 250, 0, { ...defaults, lapsesIntervalChange: 0 }).interval,
        ).toBe(1);
        // With load balancing off the interval keeps one decimal
        expect(sm2Step(Easy, 1, 250, 0, unbalanced, new DueDateHistogram()).interval).toBe(3.5);
        expect(sm2Step(Good, 1, 250, 0, unbalanced, new DueDateHistogram()).interval).toBe(2.5);
        expect(sm2Step(Easy, 4, 270, 0, unbalanced, new DueDateHistogram()).interval).toBe(15.1);
        expect(sm2Step(Good, 4, 270, 0, unbalanced, new DueDateHistogram()).interval).toBe(10.8);
        expect(sm2Step(Good, 3, 235, DAY, unbalanced, new DueDateHistogram()).interval).toBe(8.2);
        expect(sm2Step(Good, 3, 235, 5 * DAY, unbalanced, new DueDateHistogram()).interval).toBe(
            12.9,
        );
    });

    test("it never changes the histogram it is given", () => {
        const histogram = histogramOf("busy");
        const before = JSON.stringify([...histogram.dueDatesMap]);
        for (const response of Object.values(RESPONSE)) {
            sm2Step(response, 40, 250, 3 * DAY, settingsOf("defaults"), histogram);
        }
        expect(JSON.stringify([...histogram.dueDatesMap])).toBe(before);
    });
});

describe("sm2Step rules the grid cannot show on its own", () => {
    const settings = settingsOf("defaults");

    test("the window of days searched for a lighter day is the golden half-width for intervals 1 to 420", () => {
        // Every day around the raw interval holds 9 items, except one day that holds none: how far away can it be and
        // still be found? Good from x with ease 100 gives exactly x before the search.
        const reach = (interval: number, side: 1 | -1): number => {
            let farthest = 0;
            for (let distance = 1; distance <= 10; distance++) {
                const days: Record<number, number> = {};
                for (let day = interval - 12; day <= interval + 12; day++) days[day] = 9;
                days[interval + side * distance] = 0;
                const given = new DueDateHistogram(days);
                const result = sm2Step(ReviewResponse.Good, interval, 100, 0, settings, given);
                if (result.interval === interval + side * distance) farthest = distance;
            }
            return farthest;
        };
        const rows = golden.halfWidthOfTheSearchWindow;
        const bad = mismatches(rows, (row) => ({
            expected: [row.reachablePlus, row.reachableMinus],
            actual: [reach(row.interval, 1), reach(row.interval, -1)],
        }));
        expect(rows).toHaveLength(420);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("an interval of seven days or less is never moved", () => {
        const histogram = new DueDateHistogram({ 5: 9, 4: 0, 6: 0 });
        expect(sm2Step(ReviewResponse.Good, 2, 250, 0, settings, histogram).interval).toBe(5);
    });

    test("the cap applies after the search, so a lighter day cannot go past it", () => {
        const capped = { ...settings, maximumInterval: 20 };
        const histogram = new DueDateHistogram({ 25: 9, 26: 0 });
        expect(sm2Step(ReviewResponse.Good, 10, 250, 0, capped, histogram).interval).toBe(20);
    });

    test("Reset leaves the ease and keeps the interval, at least one day", () => {
        expect(sm2Step(ReviewResponse.Reset, 0.4, 250, 0, settings)).toEqual({
            interval: 1,
            ease: 250,
        });
    });
});
