import { answerButtons, trueRetention } from "src/stats/answers";
import { makeDayKeyFn } from "src/stats/day-keys";

import { entry } from "./fixtures";

const dayKey = makeDayKeyFn(0);
const TODAY = "2026-09-29";

describe("answerButtons", () => {
    const entries = [
        // learning: new and relearning answers
        entry({ k: 0, r: 3 }),
        entry({ k: 2, r: 1 }),
        // young: previous interval under 21 days
        entry({ k: 1, li: 10, r: 1 }),
        entry({ k: 1, li: 10, r: 3 }),
        entry({ k: 1, li: 10, r: 3 }),
        entry({ k: 1, li: 20.9, r: 3 }),
        // mature: previous interval of 21 days or more
        entry({ k: 1, li: 21, r: 4 }),
        entry({ k: 1, li: 25, r: 2 }),
        // not counted: cram and manual
        entry({ k: 3, r: 3 }),
        entry({ k: 4, r: 0 }),
    ];

    test("splits the buttons by learning, young and mature cards", () => {
        const result = answerButtons(entries);
        expect(result.learning.counts).toEqual([1, 0, 1, 0]);
        expect(result.young.counts).toEqual([1, 0, 3, 0]);
        expect(result.mature.counts).toEqual([0, 1, 0, 1]);
    });

    test("gives totals and the share of answers that were not Again", () => {
        const result = answerButtons(entries);
        expect(result.learning).toMatchObject({ total: 2, correct: 0.5 });
        expect(result.young).toMatchObject({ total: 4, correct: 0.75 });
        expect(result.mature).toMatchObject({ total: 2, correct: 1 });
    });

    test("a group without answers has no correct rate", () => {
        const result = answerButtons([]);
        expect(result.young).toEqual({ counts: [0, 0, 0, 0], total: 0, correct: null });
    });
});

describe("trueRetention", () => {
    const at = (iso: string) => `${iso}T10:00:00Z`;
    const entries = [
        // today
        entry({ at: at("2026-09-29"), c: "c1", k: 1, li: 30, r: 3 }),
        entry({ at: at("2026-09-29"), c: "c2", k: 1, li: 5, r: 1 }),
        entry({ at: "2026-09-29T08:00:00Z", c: "c3", k: 1, li: 5, r: 3 }),
        // a second answer to the same card on the same day does not count, only the first does
        entry({ at: "2026-09-29T11:00:00Z", c: "c3", k: 1, li: 5, r: 1 }),
        entry({ at: at("2026-09-29"), c: "c4", k: 2, li: 5, r: 1 }),
        entry({ at: at("2026-09-29"), c: "c5", k: 3, li: 5, r: 1 }),
        entry({ at: at("2026-09-29"), c: "c6", k: 4, li: 5, r: 0 }),
        // yesterday
        entry({ at: at("2026-09-28"), c: "c1", k: 1, li: 30, r: 1 }),
        // 3 days ago
        entry({ at: at("2026-09-26"), c: "c6", k: 1, li: 22, r: 3 }),
        // 20 days ago
        entry({ at: at("2026-09-09"), c: "c7", k: 1, li: 3, r: 3 }),
        // 100 days ago
        entry({ at: at("2026-06-21"), c: "c8", k: 1, li: 50, r: 4 }),
        // more than a year ago
        entry({ at: at("2025-08-25"), c: "c9", k: 1, li: 3, r: 1 }),
    ];

    const rows = trueRetention(entries, TODAY, dayKey);
    const row = (id: string) => rows.find((candidate) => candidate.id === id);

    test("has a row for today, yesterday and the last 7, 30 and 365 days", () => {
        expect(rows.map((candidate) => candidate.id)).toEqual([
            "today",
            "yesterday",
            "last7",
            "last30",
            "last365",
        ]);
    });

    test("today: only review answers, first answer of each card", () => {
        expect(row("today")).toMatchObject({
            young: { passed: 1, total: 2, rate: 0.5 },
            mature: { passed: 1, total: 1, rate: 1 },
            all: { passed: 2, total: 3 },
        });
        expect(row("today").all.rate).toBeCloseTo(2 / 3, 10);
    });

    test("yesterday", () => {
        expect(row("yesterday")).toMatchObject({
            young: { passed: 0, total: 0, rate: null },
            mature: { passed: 0, total: 1, rate: 0 },
            all: { passed: 0, total: 1, rate: 0 },
        });
    });

    test("the last 7 days include today", () => {
        expect(row("last7")).toMatchObject({
            young: { passed: 1, total: 2 },
            mature: { passed: 2, total: 3 },
            all: { passed: 3, total: 5 },
        });
    });

    test("the last 30 days", () => {
        expect(row("last30")).toMatchObject({
            young: { passed: 2, total: 3 },
            mature: { passed: 2, total: 3 },
            all: { passed: 4, total: 6 },
        });
    });

    test("the last 365 days leave out older answers", () => {
        expect(row("last365")).toMatchObject({
            young: { passed: 2, total: 3 },
            mature: { passed: 3, total: 4 },
            all: { passed: 5, total: 7 },
        });
    });

    test("empty input gives empty rows", () => {
        for (const emptyRow of trueRetention([], TODAY, dayKey)) {
            expect(emptyRow.all).toEqual({ passed: 0, total: 0, rate: null });
        }
    });

    test("answers without a card id are never merged", () => {
        const noIds = [
            entry({ at: "2026-09-29T08:00:00Z", c: "", k: 1, li: 5, r: 3 }),
            entry({ at: "2026-09-29T09:00:00Z", c: "", k: 1, li: 5, r: 3 }),
        ];
        expect(trueRetention(noIds, TODAY, dayKey)[0].all.total).toEqual(2);
    });
});
