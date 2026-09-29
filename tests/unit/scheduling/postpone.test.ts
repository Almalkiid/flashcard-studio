import moment from "moment";
import { State } from "ts-fsrs";

import { emptyCardMeta } from "src/data/card-meta";
import { Card } from "src/data/data-structures/card/card";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import {
    cardsToPostpone,
    isPostponable,
    postponedDueMs,
    postponeInText,
    PostponeOptions,
} from "src/scheduling/postpone";
import { setupStaticDateProvider20230906 } from "src/utils/dates";

const TODAY_START = Date.parse("2023-09-06T00:00:00.000Z");
const options = (days: number): PostponeOptions => ({ todayStartMs: TODAY_START, days });

beforeAll(() => {
    setupStaticDateProvider20230906();
});

function fsrsSegment(due: string, state: State, extra = ""): string {
    return `fsrs,${due},10,12.5,5.1,${state},4,0,0,2023-08-01T00:00:00.000Z${extra}`;
}

function iso(ms: number): string {
    return new Date(ms).toISOString();
}

describe("postponedDueMs", () => {
    test("a card due today moves out by the number of days, keeping its time", () => {
        const due = Date.parse("2023-09-06T10:30:00.000Z");
        expect(iso(postponedDueMs(due, options(7)))).toBe("2023-09-13T10:30:00.000Z");
    });

    test("an overdue card is counted from the start of today, not from its old date", () => {
        const due = Date.parse("2023-08-01T10:30:00.000Z");
        expect(iso(postponedDueMs(due, options(7)))).toBe("2023-09-13T00:00:00.000Z");
    });

    test("crosses month and year ends", () => {
        const endOfMonth = { todayStartMs: Date.parse("2023-09-28T00:00:00.000Z"), days: 5 };
        expect(iso(postponedDueMs(endOfMonth.todayStartMs, endOfMonth))).toBe(
            "2023-10-03T00:00:00.000Z",
        );
        const endOfYear = { todayStartMs: Date.parse("2023-12-30T00:00:00.000Z"), days: 3 };
        expect(iso(postponedDueMs(endOfYear.todayStartMs, endOfYear))).toBe(
            "2024-01-02T00:00:00.000Z",
        );
    });
});

describe("isPostponable", () => {
    const schedule = (due: string, state: State) =>
        new RepItemScheduleInfoFsrs(moment(due), 10, 5, 10, state, 3, 0, 0, moment("2023-08-01"));

    test("review cards due up to the end of today are postponable", () => {
        expect(isPostponable(schedule("2023-08-01T00:00:00.000Z", State.Review), TODAY_START)).toBe(
            true,
        );
        expect(isPostponable(schedule("2023-09-06T23:59:59.000Z", State.Review), TODAY_START)).toBe(
            true,
        );
    });

    test("a card due from tomorrow on is not", () => {
        expect(isPostponable(schedule("2023-09-07T00:00:00.000Z", State.Review), TODAY_START)).toBe(
            false,
        );
    });

    test("cards being learned or relearned are not", () => {
        expect(
            isPostponable(schedule("2023-09-06T00:10:00.000Z", State.Learning), TODAY_START),
        ).toBe(false);
        expect(
            isPostponable(schedule("2023-09-06T00:10:00.000Z", State.Relearning), TODAY_START),
        ).toBe(false);
    });

    test("a card with no schedule is not", () => {
        expect(isPostponable(null, TODAY_START)).toBe(false);
    });
});

describe("postponeInText", () => {
    test("moves an FSRS review card due today and reports one card", () => {
        const text = `Q::A <!--SR:!${fsrsSegment("2023-09-06T10:00:00.000Z", State.Review, ",id=abc123")}-->`;
        const result = postponeInText(text, options(7));
        expect(result.count).toBe(1);
        expect(result.text).toBe(
            `Q::A <!--SR:!${fsrsSegment("2023-09-13T10:00:00.000Z", State.Review, ",id=abc123")}-->`,
        );
    });

    test("moves an overdue card to today plus the days", () => {
        const text = `Q::A <!--SR:!${fsrsSegment("2023-08-20T10:00:00.000Z", State.Review)}-->`;
        expect(postponeInText(text, options(3)).text).toContain("2023-09-09T00:00:00.000Z");
    });

    test("leaves later, learning, suspended and new cards alone", () => {
        const comment =
            "!" +
            [
                fsrsSegment("2023-09-20T00:00:00.000Z", State.Review),
                fsrsSegment("2023-09-06T00:10:00.000Z", State.Learning),
                fsrsSegment("2023-09-01T00:00:00.000Z", State.Review, ",id=x,susp"),
                "fsrs,-,0,0,0,0,0,0,0,-,id=new123",
            ].join("!");
        const text = `Q::A <!--SR:${comment}-->`;
        const result = postponeInText(text, options(7));
        expect(result.count).toBe(0);
        expect(result.text).toBe(text);
    });

    test("postpones only the due cards of a note with several cards, keeping the rest verbatim", () => {
        const dueSegment = fsrsSegment("2023-09-05T08:00:00.000Z", State.Review, ",id=aaa111");
        const laterSegment = fsrsSegment("2023-10-05T08:00:00.000Z", State.Review, ",id=bbb222");
        const text = [
            "#flashcards",
            "",
            `Cloze ==one== and ==two== <!--SR:!${dueSegment}!${laterSegment}-->`,
            "",
            "Plain text that mentions !fsrs but is no comment.",
            `Other::card <!--SR:!${dueSegment}-->`,
        ].join("\n");

        const result = postponeInText(text, options(2));
        expect(result.count).toBe(2);
        expect(result.text).toContain(
            // Overdue since yesterday, so it counts from the start of today
            `!${fsrsSegment("2023-09-08T00:00:00.000Z", State.Review, ",id=aaa111")}!${laterSegment}-->`,
        );
        expect(result.text).toContain("Plain text that mentions !fsrs but is no comment.");
        expect(result.text.split("\n").filter((line) => line.startsWith("Other")).length).toBe(1);
    });

    test("moves original plugin (SM-2) cards by date", () => {
        const text = [
            "A::B <!--SR:!2023-09-01,4,250-->",
            "C::D <!--SR:!2023-09-06,4,250-->",
            "E::F <!--SR:!2023-09-07,4,250-->",
            "G::H <!--SR:!2000-01-01,1,250,id=new123,susp-->",
        ].join("\n");
        const result = postponeInText(text, options(7));
        expect(result.count).toBe(2);
        expect(result.text).toBe(
            [
                "A::B <!--SR:!2023-09-13,4,250-->",
                "C::D <!--SR:!2023-09-13,4,250-->",
                "E::F <!--SR:!2023-09-07,4,250-->",
                "G::H <!--SR:!2000-01-01,1,250,id=new123,susp-->",
            ].join("\n"),
        );
    });

    test("a second postponement finds nothing more to do", () => {
        const text = `Q::A <!--SR:!${fsrsSegment("2023-08-20T10:00:00.000Z", State.Review)}-->`;
        const once = postponeInText(text, options(7));
        const twice = postponeInText(once.text, options(7));
        expect(twice.count).toBe(0);
        expect(twice.text).toBe(once.text);
    });

    test("text without schedule comments is returned unchanged", () => {
        const text = "Just a note\n\nwith no cards.";
        expect(postponeInText(text, options(7))).toEqual({ text, count: 0 });
    });
});

describe("cardsToPostpone", () => {
    const cardWith = (due: string | null, state = State.Review, suspended = false): Card => {
        const meta = emptyCardMeta();
        meta.suspended = suspended;
        const scheduleInfo =
            due === null
                ? null
                : new RepItemScheduleInfoFsrs(
                      moment(due),
                      10,
                      5,
                      10,
                      state,
                      3,
                      0,
                      0,
                      moment("2023-08-01"),
                  );
        return new Card({ meta, scheduleInfo });
    };

    test("takes due review cards once each and skips suspended, later and new ones", () => {
        const due = cardWith("2023-09-01T00:00:00.000Z");
        const later = cardWith("2023-09-20T00:00:00.000Z");
        const fresh = cardWith(null);
        const suspended = cardWith("2023-09-01T00:00:00.000Z", State.Review, true);
        const learning = cardWith("2023-09-06T00:05:00.000Z", State.Learning);

        const result = cardsToPostpone([due, later, fresh, suspended, learning, due], TODAY_START);
        expect(result).toEqual([due]);
    });
});
