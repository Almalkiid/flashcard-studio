import type { IBuriedCards } from "src/data/data-structures/card/buried-cards";
import { Deck, DeckFilter } from "src/data/decks/deck";
import { TopicPath, TopicPathList } from "src/data/decks/topic-path";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { ReviewItemState } from "src/scheduling/schedule/review-item";

import { makeCard, questionFor, snapshot, treeOf } from "./tree-helpers";

const path = (...names: string[]) => new TopicPath(names);

/** The cards of golden `deck-ops.json`: N1 new in a; D1 due in a and b/c; L1 not due in a; R1 new, no tag. */
function opsTree() {
    const n1 = makeCard("N1", ["#a"]);
    const d1 = makeCard("D1", ["#a", "#b/c"], "due");
    const l1 = makeCard("L1", ["#a"], "future");
    const r1 = makeCard("R1", []);
    return { n1, d1, l1, r1, root: treeOf(n1, d1, l1, r1) };
}

describe("Deck against the golden vectors (deck-ops.json)", () => {
    test("appendReviewItem places by state into every named deck, the empty list into the deck called", () => {
        const { root } = opsTree();
        expect(snapshot(root)).toEqual({
            name: "root",
            new: ["R1"],
            due: [],
            sub: [
                { name: "a", new: ["N1"], due: ["D1 [due]", "L1 [scheduled-not-due]"], sub: [] },
                {
                    name: "b",
                    new: [],
                    due: [],
                    sub: [{ name: "c", new: [], due: ["D1 [due]"], sub: [] }],
                },
            ],
        });
        const a = root.getDeck(path("a"));
        a.appendReviewItem(TopicPathList.empty(), makeCard("R2"));
        expect(a.newReviewItems.map((c) => c.front)).toEqual(["N1", "R2"]);
        expect(root.newReviewItems.map((c) => c.front)).toEqual(["R1"]);
    });

    test("the same path twice adds the card twice", () => {
        const root = new Deck("root", null);
        root.appendReviewItem(questionFor(["#d", "#d"]).topicPathList, makeCard("DUP"));
        expect(root.getDeck(path("d")).newReviewItems.map((c) => c.front)).toEqual(["DUP", "DUP"]);
    });

    test("prependReviewItem creates missing decks and unshifts by state", () => {
        const { root } = opsTree();
        root.prependReviewItem(
            questionFor(["#a", "#newdeck"]).topicPathList,
            makeCard("P1", [], "due"),
        );
        expect(root.getDeck(path("a")).dueReviewItems.map((c) => c.front)).toEqual([
            "P1",
            "D1",
            "L1",
        ]);
        expect(root.getDeck(path("newdeck")).dueReviewItems.map((c) => c.front)).toEqual(["P1"]);
        root.prependReviewItem(TopicPathList.empty(), makeCard("P2"));
        expect(root.newReviewItems.map((c) => c.front)).toEqual(["P2", "R1"]);
    });

    test("a card answered after it was stored stays in the list it was put in, and both lists are searched", () => {
        const card = makeCard("FLIP", ["#a"]);
        const root = treeOf(card);
        card.scheduleInfo = { isDue: () => true } as never;
        expect(card.reviewItemState).toBe(ReviewItemState.DueItem);
        expect(root.getDeck(path("a")).newReviewItems).toEqual([card]);
        root.deleteCardFromAllDecks(card, true);
        expect(root.getDeck(path("a")).newReviewItems).toEqual([]);
    });

    test("counts: a multi-deck card counts once per deck in the sum and once in the distinct count", () => {
        const { root } = opsTree();
        const a = root.getDeck(path("a"));
        expect(a.getReviewItemCount(ReviewItemState.NewItem, false)).toBe(1);
        expect(a.getReviewItemCount(ReviewItemState.DueItem, false)).toBe(2);
        expect(a.getReviewItemCount(ReviewItemState.AnyItem, false)).toBe(3);
        expect(root.getReviewItemCount(ReviewItemState.AnyItem, true)).toBe(5);
        expect(root.getDistinctReviewItemCount(ReviewItemState.AnyItem, true)).toBe(4);
    });

    test("flattened arrays: own new, own due, then each subdeck; always a new array", () => {
        const { root } = opsTree();
        const a = root.getDeck(path("a"));
        const names = (cards: { front: string }[]) => cards.map((c) => c.front);
        expect(names(root.getFlattenedReviewItemArray(ReviewItemState.AnyItem, true))).toEqual([
            "R1",
            "N1",
            "D1",
            "L1",
            "D1",
        ]);
        expect(a.getFlattenedReviewItemArray(ReviewItemState.NewItem, false)).not.toBe(
            a.newReviewItems,
        );
        a.getFlattenedReviewItemArray(ReviewItemState.NewItem, false).pop();
        expect(a.newReviewItems).toHaveLength(1);
    });

    test("getQuestionReviewItemCount counts the question's cards in the deck", () => {
        const q = questionFor(["#a"]);
        const first = makeCard("S1", [], "new", q);
        const second = makeCard("S2", [], "new", q);
        const root = treeOf(first, second);
        expect(root.getDeck(path("a")).getQuestionReviewItemCount(q)).toBe(2);
        expect(root.getQuestionReviewItemCount(q)).toBe(0);
    });

    test("getDeck is exact and case-sensitive, and the empty path is the deck itself", () => {
        const { root } = opsTree();
        expect(root.getDeck(path("a"))?.deckName).toBe("a");
        expect(root.getDeck(path("b", "c"))?.deckName).toBe("c");
        expect(root.getDeck(path("A"))).toBeNull();
        expect(root.getDeck(path("nope", "x"))).toBeNull();
        expect(root.getDeck(TopicPath.emptyPath)).toBe(root);
        const wanted = path("b", "c");
        root.getDeck(wanted);
        expect(wanted.path).toEqual(["b", "c"]);
        expect(root.getDeckByTopicTag("#a")?.deckName).toBe("a");
        expect(root.getDeckByTopicTag("#/")).toBe(root);
        expect(() => root.getDeckByTopicTag("#")).toThrow("Invalid tag");
        expect(() => root.getDeckByTopicTag("a")).toThrow("Tag must start with #");
    });

    test("getOrCreateDeck keeps creation order, is case-sensitive and makes empty-named decks", () => {
        const root = new Deck("root", null);
        const created = root.getOrCreateDeck(path("a", "b"));
        expect(root.getOrCreateDeck(path("a", "b"))).toBe(created);
        expect(created.parent.deckName).toBe("a");
        root.getOrCreateDeck(path("a", "B"));
        expect(root.getDeck(path("a")).subdecks.map((d) => d.deckName)).toEqual(["b", "B"]);
        expect(root.getOrCreateDeck(path("", "x")).getTopicPath().path).toEqual(["", "x"]);
    });

    test("getTopicPath excludes the root; a cloned subdeck is a root", () => {
        const { root } = opsTree();
        const c = root.getDeck(path("b", "c"));
        expect(c.getTopicPath().path).toEqual(["b", "c"]);
        expect(root.getTopicPath().path).toEqual([]);
        expect(root.isRootDeck).toBe(true);
        const copy = c.parent.clone();
        expect(copy.isRootDeck).toBe(true);
        expect(copy.getTopicPath().path).toEqual([]);
        expect(copy.subdecks[0].parent).toBe(copy);
    });

    test("clone shares the cards, not the lists", () => {
        const { root, n1 } = opsTree();
        const copy = root.clone();
        expect(snapshot(copy)).toEqual(snapshot(root));
        expect(copy.getDeck(path("a")).newReviewItems[0]).toBe(n1);
        expect(copy.getDeck(path("a")).newReviewItems).not.toBe(
            root.getDeck(path("a")).newReviewItems,
        );
    });

    test("copyWithReviewItemFilter asks in order, keeps empty decks and only points at the given parent", () => {
        const { root } = opsTree();
        const asked: string[] = [];
        root.copyWithReviewItemFilter((card) => {
            asked.push((card as unknown as { front: string }).front);
            return true;
        });
        expect(asked).toEqual(["R1", "N1", "D1", "L1", "D1"]);
        const a = root.getDeck(path("a"));
        const copy = a.copyWithReviewItemFilter(() => false, root);
        expect(copy.parent).toBe(root);
        expect(root.subdecks).toHaveLength(2);
        expect(copy.newReviewItems).toEqual([]);
    });

    test("deleteCardFromAllDecks follows the question's paths", () => {
        const { root, d1 } = opsTree();
        root.deleteCardFromAllDecks(d1, true);
        expect(root.getDeck(path("a")).dueReviewItems.map((c) => c.front)).toEqual(["L1"]);
        expect(root.getDeck(path("b", "c")).dueReviewItems).toEqual([]);
    });

    test("deleteCardFromAllDecks: a missing card throws only when strict; a missing deck is skipped", () => {
        const ghost = makeCard("GHOST", ["#m"]);
        const root = new Deck("root", null);
        root.getOrCreateDeck(path("m"));
        expect(() => root.deleteCardFromAllDecks(ghost, true)).toThrow(
            "deleteCardFromThisDeck: Card: GHOST not found in deck: m",
        );
        expect(() => root.deleteCardFromAllDecks(ghost, false)).not.toThrow();
        const elsewhere = makeCard("ELSE", ["#missing"]);
        expect(() => root.deleteCardFromAllDecks(elsewhere, true)).not.toThrow();
    });

    test("a card whose question names no deck is not removed by deleteCardFromAllDecks", () => {
        const loose = makeCard("GHOST3");
        const root = treeOf(loose);
        root.deleteCardFromAllDecks(loose, true);
        expect(root.newReviewItems).toEqual([loose]);
    });

    test("deleteCardFromThisDeck removes only the first occurrence", () => {
        const twice = makeCard("TW", ["#dk", "#dk"]);
        const root = treeOf(twice);
        const dk = root.getDeck(path("dk"));
        dk.deleteCardFromThisDeck(twice, true);
        expect(dk.newReviewItems).toEqual([twice]);
    });

    test("deleteQuestionFromAllDecks removes every card of the question", () => {
        const q = questionFor(["#m"]);
        const a = makeCard("Q1", [], "new", q);
        const b = makeCard("Q2", [], "due", q);
        const root = treeOf(a, b);
        root.deleteQuestionFromAllDecks(q, true);
        expect(snapshot(root.getDeck(path("m")))).toMatchObject({ new: [], due: [] });
    });

    test("listOf names a list for new and due and refuses any", () => {
        const deck = new Deck("d", null);
        expect(deck.listOf(ReviewItemState.NewItem)).toBe(deck.newReviewItems);
        expect(deck.listOf(ReviewItemState.DueItem)).toBe(deck.dueReviewItems);
        expect(() => deck.listOf(ReviewItemState.AnyItem)).toThrow("Invalid reviewItemState");
    });

    test("toDeckArray is pre-order and sortSubdecksList uses plain character order", () => {
        const root = new Deck("root", null);
        for (const name of ["zeta", "a", "10", "Beta", "9", "alpha", "éclair", "Zeta"]) {
            root.getOrCreateDeck(path(name));
        }
        root.getOrCreateDeck(path("a", "z"));
        root.getOrCreateDeck(path("a", "B"));
        root.sortSubdecksList();
        expect(root.subdecks.map((d) => d.deckName)).toEqual([
            "10",
            "9",
            "Beta",
            "Zeta",
            "a",
            "alpha",
            "zeta",
            "éclair",
        ]);
        expect(
            root
                .toDeckArray()
                .map((d) => d.deckName)
                .slice(0, 7),
        ).toEqual(["root", "10", "9", "Beta", "Zeta", "a", "B"]);
    });
});

describe("DeckFilter (deck-lists.json: statuses-suspended-buried-postponed)", () => {
    const noPostponed: IBuriedCards = {
        clear: () => undefined,
        add: () => undefined,
        includes: () => false,
        remove: () => undefined,
        write: async () => undefined,
    };

    function statusTree() {
        const cards = {
            plainNew: makeCard("N1", ["#d"]),
            suspended: makeCard("N2", ["#d"]),
            buriedLater: makeCard("N3", ["#d"]),
            buriedToday: makeCard("N4", ["#d"]),
            future: makeCard("N6", ["#d"], "future"),
            postponed: makeCard("P1", ["#d"]),
            due: makeCard("D1", ["#d"], "due"),
        };
        cards.suspended.meta.suspended = true;
        cards.buriedLater.meta.buryUntil = "2023-09-07";
        cards.buriedToday.meta.buryUntil = "2023-09-06";
        return { cards, root: treeOf(...Object.values(cards)) };
    }

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date("2023-09-06T12:00:00Z"));
    });
    afterEach(() => jest.useRealTimers());

    test("review keeps new and due cards; suspended, buried and postponed cards go in every mode", () => {
        const { cards, root } = statusTree();
        const postponed: IBuriedCards = {
            ...noPostponed,
            includes: (question) => question === cards.postponed.question,
        };
        const review = DeckFilter.filterForRemainingReviewItems(
            postponed,
            root,
            FlashcardReviewMode.Review,
        );
        expect(snapshot(review.getDeck(path("d"))).new).toEqual(["N1", "N4"]);
        expect(snapshot(review.getDeck(path("d"))).due).toEqual(["D1 [due]"]);
        const cram = DeckFilter.filterForRemainingReviewItems(
            postponed,
            root,
            FlashcardReviewMode.Cram,
        );
        expect(snapshot(cram.getDeck(path("d"))).due).toEqual([
            "N6 [scheduled-not-due]",
            "D1 [due]",
        ]);
        expect(snapshot(cram.getDeck(path("d"))).new).toEqual(["N1", "N4"]);
    });
});
