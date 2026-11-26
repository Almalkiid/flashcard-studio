import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { Fsrs7Card, Fsrs7Engine } from "src/scheduling/fsrs7/fsrs7-engine";

const NOW = new Date("2026-11-26T12:00:00.000Z");
const MIN = 60_000;
const DAY = 86_400_000;
const engine = (settings: Partial<StudioSettings> = {}) =>
    new Fsrs7Engine({ ...DEFAULT_SETTINGS, ...settings });

/** A card graduated by Good, Good (1m 10m steps) and answered Good again `days` later. */
function reviewCard(e: Fsrs7Engine): Fsrs7Card {
    const learning = e.answers(e.newCard(NOW), NOW, "c1")[3];
    return e.answers(learning, new Date(NOW.valueOf() + 10 * MIN), "c1")[3];
}

describe("FSRS-7 engine", () => {
    test("a new card keeps the learning steps: Again +1m, Hard +5m30s, Good +10m, Easy graduates", () => {
        const e = engine();
        const answers = e.answers(e.newCard(NOW), NOW, "c1");
        expect([1, 2, 3].map((g) => answers[g as 1 | 2 | 3].due.valueOf() - NOW.valueOf())).toEqual(
            [MIN, 5.5 * MIN, 10 * MIN],
        );
        expect([answers[1].state, answers[3].state, answers[4].state]).toEqual([1, 1, 2]);
        expect(answers[4].intervalDays).toBeGreaterThanOrEqual(1);
    });

    test("a review interval is whole days, due that many days after the answer", () => {
        const e = engine();
        const card = reviewCard(e);
        expect(card.state).toBe(2);
        expect(Number.isInteger(card.intervalDays)).toBe(true);
        expect(card.due.valueOf()).toBe(NOW.valueOf() + 10 * MIN + card.intervalDays * DAY);
    });

    test("the memory has two traces and a difficulty, and S90 is where recall falls to 90%", () => {
        const e = engine();
        const { memory } = reviewCard(e);
        expect(memory.stability).toBeGreaterThan(0);
        expect(memory.stabilityFast).toBeGreaterThan(0);
        expect(memory.difficulty).toBeGreaterThanOrEqual(1);
        expect(e.recall(memory, e.s90(memory))).toBeCloseTo(0.9, 9);
    });

    test("with fuzz on, the interval on a button is the one applied 5 minutes later", () => {
        const e = engine({ fsrsEnableFuzz: true });
        const card = reviewCard(e);
        const at = new Date(card.due.valueOf() + 3 * DAY);
        const later = new Date(at.valueOf() + 5 * MIN);
        const shown = e.answers(card, at, "c1");
        const applied = e.answers(card, later, "c1");
        expect([2, 3, 4].map((g) => applied[g as 2].intervalDays)).toEqual(
            [2, 3, 4].map((g) => shown[g as 2].intervalDays),
        );
    });

    test("intervals stay within the maximum", () => {
        const e = engine({ maximumInterval: 5 });
        const card = reviewCard(e);
        const answers = e.answers(card, new Date(card.due.valueOf() + 60 * DAY), "c1");
        expect(
            Math.max(...[1, 2, 3, 4].map((g) => answers[g as 1].intervalDays)),
        ).toBeLessThanOrEqual(5);
    });

    test("replaying no answers gives nothing; replaying answers equals answering them one by one", () => {
        const e = engine();
        expect(e.replay([])).toBeNull();
        const times = [0, 10 * MIN, 4 * DAY, 20 * DAY].map((ms) => NOW.valueOf() + ms);
        const ratings = [3, 3, 3, 1] as const;
        let card = e.newCard(NOW);
        times.forEach((t, i) => (card = e.answers(card, new Date(t), "replay")[ratings[i]]));
        const replayed = e.replay(times.map((t, i) => ({ t, rating: ratings[i] })));
        expect(replayed?.memory).toEqual(card.memory);
        expect([replayed?.state, replayed?.reps, replayed?.lapses]).toEqual([
            card.state,
            card.reps,
            card.lapses,
        ]);
    });
});
