import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { makeDayKeyFn } from "src/stats/day-keys";
import { buildStatsReport, ReportOptions } from "src/stats/report";
import { StatsCard } from "src/stats/types";

import { DAY_MS, entry, statsCard } from "./fixtures";

const NOW = new Date("2026-09-29T12:00:00Z").getTime();

function options(overrides: Partial<ReportOptions> = {}): ReportOptions {
    return {
        nowMs: NOW,
        dayKeyOf: makeDayKeyFn(0),
        weekStart: 0,
        deck: "",
        range: "1m",
        ...overrides,
    };
}

describe("buildStatsReport", () => {
    const entries: ReviewLogEntry[] = [
        entry({ at: "2026-09-29T09:00:00Z", dk: "CIA/Part1", r: 3 }),
        entry({ at: "2026-09-29T09:05:00Z", dk: "CIA/Part1", r: 1 }),
        entry({ at: "2026-09-28T09:00:00Z", dk: "Spanish", r: 3 }),
        entry({ at: "2026-06-01T09:00:00Z", dk: "CIA/Part1", r: 3 }),
    ];
    const cards: StatsCard[] = [
        statsCard({ decks: ["CIA/Part1"], dueMs: NOW + DAY_MS, lastReviewMs: NOW - DAY_MS }),
        statsCard({ decks: ["Spanish"], state: "new", intervalDays: 0 }),
    ];

    test("covers everything for the empty deck scope", () => {
        const report = buildStatsReport(entries, cards, options());
        expect(report.todayKey).toEqual("2026-09-29");
        expect(report.hasHistory).toBe(true);
        expect(report.today.reviews).toEqual(2);
        expect(report.streak).toMatchObject({ current: 2, activeDays: 3 });
        expect(report.cardCounts.total).toEqual(2);
        expect(report.heatmap.total).toEqual(4);
    });

    test("a deck scope narrows the entries and the cards", () => {
        const report = buildStatsReport(entries, cards, options({ deck: "CIA" }));
        expect(report.streak.current).toEqual(1);
        expect(report.cardCounts.total).toEqual(1);
        expect(report.heatmap.total).toEqual(3);
    });

    test("the time range limits the daily chart, the buttons and the forecast, not today or the heatmap", () => {
        const month = buildStatsReport(entries, cards, options({ range: "1m" }));
        const all = buildStatsReport(entries, cards, options({ range: "all" }));
        expect(month.daily).toHaveLength(30);
        expect(month.dailyGranularity).toEqual("day");
        expect(month.forecast.days).toHaveLength(30);
        expect(month.answerButtons.young.total).toEqual(3);
        expect(all.answerButtons.young.total).toEqual(4);
        expect(month.today).toEqual(all.today);
        expect(month.heatmap.total).toEqual(all.heatmap.total);
        // All history starts at the first entry, 2026-06-01, which is more than a year of weekly buckets away
        expect(all.daily[0].day <= "2026-06-01").toBe(true);
    });

    test("long ranges are bucketed into weeks and then months", () => {
        expect(buildStatsReport(entries, cards, options({ range: "3m" })).dailyGranularity).toEqual(
            "day",
        );
        expect(buildStatsReport(entries, cards, options({ range: "1y" })).dailyGranularity).toEqual(
            "week",
        );
        const decade = [entry({ at: "2016-01-05T09:00:00Z" }), ...entries];
        expect(buildStatsReport(decade, cards, options({ range: "all" })).dailyGranularity).toEqual(
            "month",
        );
    });

    test("without history the report says so and still describes the cards", () => {
        const report = buildStatsReport([], cards, options());
        expect(report.hasHistory).toBe(false);
        expect(report.today.reviews).toEqual(0);
        expect(report.streak).toEqual({ current: 0, longest: 0, activeDays: 0 });
        expect(report.cardCounts.total).toEqual(2);
        expect(report.daily.every((row) => row.total === 0)).toBe(true);
    });

    test("history of other decks does not count as history of this scope", () => {
        const report = buildStatsReport(entries, cards, options({ deck: "Nope" }));
        expect(report.hasHistory).toBe(false);
    });

    test("aggregates 50 000 entries and 5 000 cards in under half a second", () => {
        const many: ReviewLogEntry[] = [];
        const start = new Date("2024-10-01T00:00:00Z").getTime();
        for (let i = 0; i < 50000; i++) {
            many.push(
                entry({
                    t: start + Math.floor((i / 50000) * 725 * DAY_MS),
                    c: `c${i % 4000}`,
                    r: ((i % 4) + 1) as ReviewLogEntry["r"],
                    k: i % 7 === 0 ? 0 : i % 11 === 0 ? 2 : 1,
                    li: i % 60,
                    dk: `Deck${i % 8}/Sub${i % 3}`,
                }),
            );
        }
        const manyCards = Array.from({ length: 5000 }, (_, i) =>
            statsCard({
                id: `k${i}`,
                decks: [`Deck${i % 8}/Sub${i % 3}`],
                dueMs: NOW + ((i % 200) - 20) * DAY_MS,
                intervalDays: i % 90,
                stability: 1 + (i % 100),
                difficulty: 1 + (i % 9),
                lastReviewMs: NOW - (i % 50) * DAY_MS,
            }),
        );
        const begin = Date.now();
        const report = buildStatsReport(many, manyCards, options({ range: "all" }));
        const elapsed = Date.now() - begin;
        expect(report.heatmap.total).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(500);
    });
});
