import { createEmptyCard, State } from "ts-fsrs";

import { Card } from "src/data/data-structures/card/flashcard";
import { Question } from "src/data/data-structures/card/question";
import { buildReviewLogEntry } from "src/scheduling/review-log-builder";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { setupStaticDateProvider } from "src/utils/clock";

// D2 #4: the first answer after a Reset introduces the card again, so it counts as a new card, like a card never
// reviewed. Before, an FSRS card reset to the New state escaped both daily allowances.

const NOW = Date.UTC(2023, 8, 6);
const reset = () => FsrsState.fromFsrsCard(createEmptyCard(new Date(NOW)));
const learning = () =>
    FsrsState.fromFsrsCard({
        ...createEmptyCard(new Date(NOW)),
        state: State.Learning,
        due: new Date(NOW + 600_000),
    });
const review = () =>
    FsrsState.fromFsrsCard({
        ...createEmptyCard(new Date(NOW)),
        state: State.Review,
        stability: 4,
        difficulty: 5,
        scheduled_days: 4, // eslint-disable-line camelcase -- ts-fsrs field
    });

function answer(old: ScheduleState | null, response: ReviewResponse, cram = false) {
    const card = new Card({ question: { topicPathList: null, note: null } as unknown as Question });
    card.scheduleInfo = learning();
    return buildReviewLogEntry(card, response, old, 0, cram, NOW);
}

beforeEach(() => setupStaticDateProvider("2023-09-06"));

test.each([
    ["a card never reviewed", (): ScheduleState | null => null, 1],
    ["an FSRS card reset to New", reset, 1],
    ["an FSRS card in learning", learning, undefined],
    ["an FSRS review card", review, undefined],
    ["an SM-2 card", () => Sm2State.fromDueDateStr("2023-09-06", 1, 250), undefined],
])("the first graded answer of %s", (_name, old, n) => {
    expect(answer(old(), ReviewResponse.Good).n).toBe(n);
});

test("a reset card's answer is a learning step, not a review", () => {
    expect(answer(reset(), ReviewResponse.Good)).toMatchObject({ k: 0, n: 1, r: 3 });
});

test("a Reset itself and a cram answer never count as new", () => {
    expect(answer(reset(), ReviewResponse.Reset).n).toBeUndefined();
    expect(answer(reset(), ReviewResponse.Good, true).n).toBeUndefined();
    expect(answer(null, ReviewResponse.Good, true).n).toBeUndefined();
});
