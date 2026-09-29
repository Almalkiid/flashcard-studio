import { makeDayKeyFn } from "src/stats/day-keys";
import { buildSessionSummary } from "src/stats/session";

import { entry } from "./fixtures";

const dayKey = makeDayKeyFn(0);
const TODAY = "2026-09-29";
const START = new Date("2026-09-29T09:00:00Z").getTime();

describe("buildSessionSummary", () => {
    const entries = [
        // history before the session counts for the streak only
        entry({ at: "2026-09-27T20:00:00Z", r: 3 }),
        entry({ at: "2026-09-28T20:00:00Z", r: 3 }),
        entry({ at: "2026-09-29T08:59:59Z", r: 1, k: 1 }),
        // the session
        entry({ at: "2026-09-29T09:00:00Z", r: 3, k: 1, ms: 4000 }),
        entry({ at: "2026-09-29T09:01:00Z", r: 1, k: 1, ms: 6000 }),
        entry({ at: "2026-09-29T09:02:00Z", r: 4, k: 0, n: 1, ms: 2000 }),
        entry({ at: "2026-09-29T09:03:00Z", r: 0, k: 4, ms: 0 }),
    ];

    test("summarizes only the answers given since the session started", () => {
        const summary = buildSessionSummary(entries, START, TODAY, dayKey);
        expect(summary.reviews).toEqual(3);
        expect(summary.timeMs).toEqual(12000);
        expect(summary.again).toEqual(1);
        expect(summary.newLearned).toEqual(1);
        expect(summary.retention).toEqual(0.5);
    });

    test("the streak counts the days before the session and today", () => {
        expect(buildSessionSummary(entries, START, TODAY, dayKey).streak).toEqual(3);
    });

    test("a session without answers has zero reviews", () => {
        const summary = buildSessionSummary(entries.slice(0, 3), START, TODAY, dayKey);
        expect(summary.reviews).toEqual(0);
        expect(summary.retention).toBeNull();
    });
});
