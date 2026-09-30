import moment from "moment";
import { State } from "ts-fsrs";

import { emptyCardMeta } from "src/data/card-meta";
import { Card } from "src/data/data-structures/card/card";
import { Question } from "src/data/data-structures/card/questions/question";
import { Deck } from "src/data/data-structures/deck/deck";
import { TopicPath, TopicPathList } from "src/data/data-structures/deck/topic-path";
import { LimitOverride } from "src/data/plugin-data";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { RepItemState } from "src/scheduling/algorithms/base/repetition-item";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import {
    allowanceFor,
    buildCustomStudyTree,
    cardKey,
    customStudyMode,
    customStudyPredicate,
    CustomStudySpec,
    forgottenCardIds,
    increaseAllowance,
    isAvailable,
    isDueWithin,
    isForgotten,
    isInDeck,
    limitCards,
    monthsBetween,
} from "src/scheduling/custom-study";
import { DailyLimits } from "src/scheduling/daily-limits";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import { setupStaticDateProvider20230906 } from "src/utils/dates";

const NOW = Date.parse("2023-09-06T00:00:00.000Z");
const DAY = 86400000;
const TODAY = "2023-09-06";

beforeAll(() => {
    setupStaticDateProvider20230906();
});

interface CardOptions {
    id?: string;
    deck?: string[];
    /** Days from now until the card is due; undefined for a new card. */
    dueInDays?: number;
    flag?: number;
    leech?: boolean;
    suspended?: boolean;
    buryUntil?: string;
    /** Where the card is written, for a card that has no id yet. */
    path?: string;
    hash?: string;
    cardIdx?: number;
}

function makeCard(options: CardOptions = {}): Card {
    const meta = emptyCardMeta();
    meta.id = options.id ?? null;
    meta.flag = options.flag ?? 0;
    meta.leech = options.leech ?? false;
    meta.suspended = options.suspended ?? false;
    meta.buryUntil = options.buryUntil ?? null;

    const deckPaths = (options.deck ?? ["CIA/Part1"]).map((path) => new TopicPath(path.split("/")));
    const question = {
        topicPathList: new TopicPathList(deckPaths),
        note: { filePath: options.path ?? "CIA/Part1.md" },
        questionText: { textHash: options.hash ?? "h0" },
    } as Question;

    const scheduleInfo =
        options.dueInDays === undefined
            ? null
            : new RepItemScheduleInfoFsrs(
                  moment(NOW + options.dueInDays * DAY),
                  10,
                  5,
                  10,
                  State.Review,
                  3,
                  0,
                  0,
                  moment(NOW - 10 * DAY),
              );
    return new Card({ question, meta, scheduleInfo, cardIdx: options.cardIdx ?? 0 });
}

const context = (forgottenIds: string[] = []) => ({
    nowMs: NOW,
    todayYmd: TODAY,
    forgottenIds: new Set(forgottenIds),
});

describe("predicates", () => {
    test("isForgotten matches on the card id, and never for a card without one", () => {
        const ids = new Set(["abc123"]);
        expect(isForgotten(makeCard({ id: "abc123", dueInDays: 3 }), ids)).toBe(true);
        expect(isForgotten(makeCard({ id: "zzz999", dueInDays: 3 }), ids)).toBe(false);
        expect(isForgotten(makeCard({ dueInDays: 3 }), ids)).toBe(false);
    });

    test("isDueWithin includes overdue cards and cards inside the window, not new or later ones", () => {
        expect(isDueWithin(makeCard({ dueInDays: -5 }), 3, NOW)).toBe(true);
        expect(isDueWithin(makeCard({ dueInDays: 0 }), 3, NOW)).toBe(true);
        expect(isDueWithin(makeCard({ dueInDays: 3 }), 3, NOW)).toBe(true);
        expect(isDueWithin(makeCard({ dueInDays: 3.5 }), 3, NOW)).toBe(false);
        expect(isDueWithin(makeCard({}), 3, NOW)).toBe(false);
    });

    test("isInDeck matches the deck, its subdecks and any of the card's decks, not a lookalike", () => {
        const card = makeCard({ deck: ["CIA/Part1/Risk", "Trivia"] });
        expect(isInDeck(card, "CIA")).toBe(true);
        expect(isInDeck(card, "CIA/Part1")).toBe(true);
        expect(isInDeck(card, "CIA/Part1/Risk")).toBe(true);
        expect(isInDeck(card, "Trivia")).toBe(true);
        expect(isInDeck(card, "CIA/Part2")).toBe(false);
        expect(isInDeck(card, "CI")).toBe(false);
        expect(isInDeck(card, "CIA/Part1/Risk/Deep")).toBe(false);
    });

    test("isAvailable leaves out suspended cards and cards buried until a later day", () => {
        expect(isAvailable(makeCard({}), TODAY)).toBe(true);
        expect(isAvailable(makeCard({ suspended: true }), TODAY)).toBe(false);
        expect(isAvailable(makeCard({ buryUntil: "2023-09-07" }), TODAY)).toBe(false);
        expect(isAvailable(makeCard({ buryUntil: "2023-09-06" }), TODAY)).toBe(true);
    });
});

describe("customStudyPredicate", () => {
    test("forgotten: only the cards answered Again, and never suspended ones", () => {
        const predicate = customStudyPredicate({ type: "forgotten", days: 1 }, context(["a", "b"]));
        expect(predicate(makeCard({ id: "a", dueInDays: 5 }))).toBe(true);
        expect(predicate(makeCard({ id: "b", dueInDays: 5, suspended: true }))).toBe(false);
        expect(predicate(makeCard({ id: "c", dueInDays: 5 }))).toBe(false);
    });

    test("ahead: cards due within the window", () => {
        const predicate = customStudyPredicate({ type: "ahead", days: 2 }, context());
        expect(predicate(makeCard({ dueInDays: 1 }))).toBe(true);
        expect(predicate(makeCard({ dueInDays: 5 }))).toBe(false);
        expect(predicate(makeCard({}))).toBe(false);
        expect(predicate(makeCard({ dueInDays: 1, buryUntil: "2023-09-08" }))).toBe(false);
    });

    test("preview: new cards only", () => {
        const predicate = customStudyPredicate({ type: "preview", count: 5 }, context());
        expect(predicate(makeCard({}))).toBe(true);
        expect(predicate(makeCard({ dueInDays: 0 }))).toBe(false);
        expect(predicate(makeCard({ suspended: true }))).toBe(false);
    });

    describe("filter", () => {
        const spec = (overrides: Partial<Extract<CustomStudySpec, { type: "filter" }>> = {}) =>
            customStudyPredicate(
                {
                    type: "filter",
                    decks: [],
                    state: "all",
                    flag: 0,
                    leechOnly: false,
                    count: 0,
                    ...overrides,
                },
                context(),
            );

        test("by default every available card", () => {
            expect(spec()(makeCard({}))).toBe(true);
            expect(spec()(makeCard({ dueInDays: 30 }))).toBe(true);
            expect(spec()(makeCard({ suspended: true }))).toBe(false);
        });

        test("by state", () => {
            expect(spec({ state: "new" })(makeCard({}))).toBe(true);
            expect(spec({ state: "new" })(makeCard({ dueInDays: 0 }))).toBe(false);
            expect(spec({ state: "due" })(makeCard({ dueInDays: -1 }))).toBe(true);
            expect(spec({ state: "due" })(makeCard({ dueInDays: 4 }))).toBe(false);
            expect(spec({ state: "due" })(makeCard({}))).toBe(false);
        });

        test("by flag colour", () => {
            expect(spec({ flag: 3 })(makeCard({ flag: 3 }))).toBe(true);
            expect(spec({ flag: 3 })(makeCard({ flag: 1 }))).toBe(false);
            expect(spec({ flag: 3 })(makeCard({}))).toBe(false);
            expect(spec({ flag: 0 })(makeCard({ flag: 5 }))).toBe(true);
        });

        test("by leech mark", () => {
            expect(spec({ leechOnly: true })(makeCard({ leech: true }))).toBe(true);
            expect(spec({ leechOnly: true })(makeCard({}))).toBe(false);
            expect(spec({ leechOnly: false })(makeCard({ leech: true }))).toBe(true);
        });

        test("by deck or tag, any of several", () => {
            const cia = makeCard({ deck: ["CIA/Part1"] });
            const trivia = makeCard({ deck: ["Trivia"] });
            const other = makeCard({ deck: ["Other"] });
            const predicate = spec({ decks: ["CIA", "Trivia"] });
            expect(predicate(cia)).toBe(true);
            expect(predicate(trivia)).toBe(true);
            expect(predicate(other)).toBe(false);
        });

        test("criteria combine", () => {
            const predicate = spec({ decks: ["CIA"], state: "due", flag: 2, leechOnly: true });
            expect(predicate(makeCard({ dueInDays: 0, flag: 2, leech: true }))).toBe(true);
            expect(predicate(makeCard({ dueInDays: 0, flag: 2 }))).toBe(false);
            expect(predicate(makeCard({ dueInDays: 0, flag: 2, leech: true, deck: ["X"] }))).toBe(
                false,
            );
        });
    });
});

describe("customStudyMode", () => {
    test("only review ahead reschedules; everything else is cram", () => {
        expect(customStudyMode({ type: "cards", ids: ["a"] })).toBe(FlashcardReviewMode.Cram);
        expect(customStudyMode({ type: "ahead", days: 1 })).toBe(FlashcardReviewMode.Review);
        expect(customStudyMode({ type: "forgotten", days: 1 })).toBe(FlashcardReviewMode.Cram);
        expect(customStudyMode({ type: "preview", count: 1 })).toBe(FlashcardReviewMode.Cram);
        expect(
            customStudyMode({
                type: "filter",
                decks: [],
                state: "all",
                flag: 0,
                leechOnly: false,
                count: 0,
            }),
        ).toBe(FlashcardReviewMode.Cram);
    });
});

describe("limitCards", () => {
    test("keeps the first cards the predicate accepts", () => {
        const cards = [makeCard({}), makeCard({}), makeCard({}), makeCard({})];
        const predicate = limitCards(() => true, 2);
        expect(cards.map((card) => predicate(card))).toEqual([true, true, false, false]);
    });

    test("a card seen again is still accepted and does not use a second place", () => {
        const [a, b, c] = [makeCard({}), makeCard({}), makeCard({})];
        const predicate = limitCards(() => true, 2);
        expect([a, b, a, c, b].map((card) => predicate(card))).toEqual([
            true,
            true,
            true,
            false,
            true,
        ]);
    });

    test("cards the predicate refuses do not use a place", () => {
        const skip = makeCard({});
        const keep1 = makeCard({});
        const keep2 = makeCard({});
        const predicate = limitCards((card) => card !== skip, 1);
        expect([skip, keep1, keep2].map((card) => predicate(card))).toEqual([false, true, false]);
    });

    test("no limit keeps everything", () => {
        const predicate = limitCards(() => true, 0);
        expect([makeCard({}), makeCard({})].map((card) => predicate(card))).toEqual([true, true]);
    });
});

describe("buildCustomStudyTree", () => {
    function buildTree(): { tree: Deck; cards: Card[] } {
        const tree = new Deck("root", null);
        const cards = [
            makeCard({ id: "a", deck: ["CIA/Part1"], dueInDays: 1 }),
            makeCard({ id: "b", deck: ["CIA/Part1"] }),
            makeCard({ id: "c", deck: ["CIA/Part2"], dueInDays: 10 }),
            makeCard({ id: "d", deck: ["CIA/Part2"] }),
            makeCard({ id: "e", deck: ["CIA/Part1", "Trivia"] }),
        ];
        for (const card of cards) tree.appendRepItem(card.question.topicPathList, card);
        return { tree, cards };
    }

    test("keeps the decks and only the chosen cards, leaving the source tree alone", () => {
        const { tree } = buildTree();
        const before = tree.getDistinctRepItemCount(RepItemState.AnyItem, true);
        const filtered = buildCustomStudyTree(tree, { type: "preview", count: 0 }, context());

        expect(filtered.getDistinctRepItemCount(RepItemState.NewItem, true)).toBe(3);
        expect(filtered.getDistinctRepItemCount(RepItemState.DueItem, true)).toBe(0);
        expect(filtered.getDeck(new TopicPath(["CIA", "Part2"]))).not.toBeNull();
        expect(tree.getDistinctRepItemCount(RepItemState.AnyItem, true)).toBe(before);
    });

    test("a preview stops at the requested number of new cards, counting a shared card once", () => {
        const { tree } = buildTree();
        const filtered = buildCustomStudyTree(tree, { type: "preview", count: 2 }, context());
        expect(filtered.getDistinctRepItemCount(RepItemState.NewItem, true)).toBe(2);
    });

    test("forgotten cards come from the review log ids", () => {
        const { tree } = buildTree();
        const filtered = buildCustomStudyTree(
            tree,
            { type: "forgotten", days: 1 },
            context(["a", "c"]),
        );
        expect(filtered.getDistinctRepItemCount(RepItemState.AnyItem, true)).toBe(2);
    });

    test("review ahead takes cards due inside the window", () => {
        const { tree } = buildTree();
        const filtered = buildCustomStudyTree(tree, { type: "ahead", days: 3 }, context());
        expect(filtered.getDistinctRepItemCount(RepItemState.AnyItem, true)).toBe(1);
    });
});

describe("review log helpers", () => {
    const entry = (overrides: Partial<ReviewLogEntry>): ReviewLogEntry => ({
        t: NOW,
        c: "abc123",
        r: 3,
        k: 1,
        ivl: 1,
        li: 1,
        ms: 1,
        dk: "",
        f: "",
        ...overrides,
    });

    test("forgottenCardIds takes Again answers since the start, of any kind", () => {
        const ids = forgottenCardIds(
            [
                entry({ c: "old", r: 1, t: NOW - DAY }),
                entry({ c: "again", r: 1 }),
                entry({ c: "cram", r: 1, k: 3 }),
                entry({ c: "good", r: 3 }),
                entry({ c: "", r: 1 }),
            ],
            NOW,
        );
        expect([...ids].sort()).toEqual(["again", "cram"]);
    });

    test("monthsBetween lists every month in the span, including the ones in between", () => {
        expect(
            monthsBetween(new Date(2026, 0, 31).getTime(), new Date(2026, 2, 1).getTime()),
        ).toEqual(["2026-01", "2026-02", "2026-03"]);
        expect(
            monthsBetween(new Date(2026, 8, 10).getTime(), new Date(2026, 8, 29).getTime()),
        ).toEqual(["2026-09"]);
        expect(
            monthsBetween(new Date(2025, 11, 20).getTime(), new Date(2026, 0, 3).getTime()),
        ).toEqual(["2025-12", "2026-01"]);
    });
});

describe("today's limit override", () => {
    const todayOverride: LimitOverride = { date: TODAY, extraNew: 5, extraReviews: 10 };

    test("allowanceFor counts the override only on the day it was set", () => {
        expect(allowanceFor(todayOverride, TODAY)).toEqual({ extraNew: 5, extraReviews: 10 });
        expect(allowanceFor(todayOverride, "2023-09-07")).toEqual({
            extraNew: 0,
            extraReviews: 0,
        });
        expect(allowanceFor(undefined, TODAY)).toEqual({ extraNew: 0, extraReviews: 0 });
        expect(allowanceFor({ date: "", extraNew: 0, extraReviews: 0 }, TODAY)).toEqual({
            extraNew: 0,
            extraReviews: 0,
        });
    });

    test("increaseAllowance adds to today's extra and starts again on a new day", () => {
        const more = increaseAllowance(todayOverride, TODAY, "new", 3);
        expect(more).toEqual({ date: TODAY, extraNew: 8, extraReviews: 10 });

        const moreReviews = increaseAllowance(more, TODAY, "reviews", 20);
        expect(moreReviews).toEqual({ date: TODAY, extraNew: 8, extraReviews: 30 });

        const nextDay = increaseAllowance(moreReviews, "2023-09-07", "new", 4);
        expect(nextDay).toEqual({ date: "2023-09-07", extraNew: 4, extraReviews: 0 });
    });

    test("DailyLimits gives the extra allowance on top of the daily limit", () => {
        const settings = { dailyLimitsEnabled: true, newCardsPerDay: 2, reviewsPerDay: 3 };
        const counts = { newDone: 2, reviewsDone: 3 };
        const without = new DailyLimits(settings, counts);
        expect(without.remainingNew()).toBe(0);
        expect(without.remainingReviews()).toBe(0);

        const withExtra = new DailyLimits(settings, counts, allowanceFor(todayOverride, TODAY));
        expect(withExtra.remainingNew()).toBe(5);
        expect(withExtra.remainingReviews()).toBe(10);

        const nextDay = new DailyLimits(
            settings,
            counts,
            allowanceFor(todayOverride, "2023-09-07"),
        );
        expect(nextDay.remainingNew()).toBe(0);
    });

    test("the extra allowance does not switch limits on when they are off", () => {
        const limits = new DailyLimits(
            { dailyLimitsEnabled: false, newCardsPerDay: 2, reviewsPerDay: 3 },
            { newDone: 9, reviewsDone: 9 },
            { extraNew: 1, extraReviews: 1 },
        );
        expect(limits.remainingNew()).toBe(Infinity);
    });
});

describe("cards: the ones an exam missed", () => {
    test("cardKey is the card's id, or where the card is written when it has none yet", () => {
        expect(cardKey(makeCard({ id: "abc123" }))).toBe("abc123");
        const fresh = makeCard({ path: "CIA/Charter.md", hash: "h9", cardIdx: 1 });
        expect(cardKey(fresh)).toBe("CIA/Charter.md|h9|1");
        // The same text on another line of another note is another card
        expect(cardKey(makeCard({ path: "CIA/Other.md", hash: "h9", cardIdx: 1 }))).not.toBe(
            cardKey(fresh),
        );
    });

    test("takes exactly the listed cards, by id or by place", () => {
        const fresh = makeCard({ path: "CIA/Charter.md", hash: "h9" });
        const predicate = customStudyPredicate(
            { type: "cards", ids: ["a", cardKey(fresh)] },
            context(),
        );
        expect(predicate(makeCard({ id: "a", dueInDays: 5 }))).toBe(true);
        expect(predicate(makeCard({ id: "b", dueInDays: 5 }))).toBe(false);
        expect(predicate(fresh)).toBe(true);
        expect(predicate(makeCard({ path: "CIA/Charter.md", hash: "other" }))).toBe(false);
    });

    test("a suspended card is left out, a buried one is not: the person asked for it", () => {
        const predicate = customStudyPredicate({ type: "cards", ids: ["a", "b"] }, context());
        expect(predicate(makeCard({ id: "a", suspended: true }))).toBe(false);
        expect(predicate(makeCard({ id: "b", buryUntil: "2023-09-08" }))).toBe(true);
    });

    test("a session of the missed cards keeps only those cards, in their decks", () => {
        const tree = new Deck("root", null);
        const cards = [
            makeCard({ id: "a", deck: ["CIA/Part1"] }),
            makeCard({ id: "b", deck: ["CIA/Part1"], dueInDays: 2 }),
            makeCard({ id: "c", deck: ["CIA/Part2"] }),
        ];
        for (const card of cards) tree.appendRepItem(card.question.topicPathList, card);
        const filtered = buildCustomStudyTree(tree, { type: "cards", ids: ["a", "c"] }, context());
        expect(filtered.getDistinctRepItemCount(RepItemState.AnyItem, true)).toBe(2);
        expect(filtered.getDeck(new TopicPath(["CIA", "Part2"]))).not.toBeNull();
    });
});
