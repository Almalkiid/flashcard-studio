/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- the golden vectors are untyped JSON */
import type { Card } from "src/data/data-structures/card/flashcard";
import type { Deck } from "src/data/decks/deck";
import { TopicPath } from "src/data/decks/topic-path";
import { DeckOrder, DeckWalker, PickOrder, shuffleKey } from "src/data/decks/walker";
import { setupStaticDateProvider } from "src/utils/clock";
import { cyrb53 } from "src/utils/hash";

import { loadGolden } from "./golden";
import { makeCard, questionFor, treeOf } from "./tree-helpers";

const golden = loadGolden("walker-orders.json");

const tag = (name: string) => TopicPath.getTopicPathFromTag(name);

/** The golden fixture: flashcards [new A1 A3, due A2 A4], b [B1 M1 / B2 M2], c [M1 / M2] (M in b and c), d [D1]. */
function fixture(): { root: Deck; cards: Record<string, Card> } {
    const cards: Record<string, Card> = {};
    const add = (front: string, tags: string[], status: "new" | "due") =>
        (cards[front] = makeCard(front, tags, status));
    add("A1", ["#flashcards"], "new");
    add("A2", ["#flashcards"], "due");
    add("A3", ["#flashcards"], "new");
    add("A4", ["#flashcards"], "due");
    add("B1", ["#flashcards/b"], "new");
    add("B2", ["#flashcards/b"], "due");
    add("M1", ["#flashcards/c", "#flashcards/b"], "new");
    add("M2", ["#flashcards/c", "#flashcards/b"], "due");
    add("D1", ["#flashcards/d"], "new");
    const root = treeOf(...Object.values(cards));
    root.sortSubdecksList();
    return { root, cards };
}

const deckLabel = (deck: Deck | null) => deck?.getTopicPath().path.join("/") ?? null;

/** Walks the whole iteration, returning the card and the deck of each step. */
function walk(iterator: DeckWalker, path: TopicPath): { card: string; deck: string }[] {
    const seen: { card: string; deck: string }[] = [];
    iterator.setIteratorTopicPath(path);
    while (iterator.nextReviewItem()) {
        seen.push({
            card: iterator.currentReviewItem.front,
            deck: deckLabel(iterator.currentDeck),
        });
    }
    return seen;
}

const plainTree = (deck: Deck): unknown => ({
    name: deck.deckName,
    new: deck.newReviewItems.map((c) => c.front),
    due: deck.dueReviewItems.map((c) => c.front),
    sub: deck.subdecks.map(plainTree),
});

const START = {
    "(whole tree)": TopicPath.emptyPath,
    "#flashcards/b": tag("#flashcards/b"),
} as const;
const iteratorFor = (root: Deck, cardOrder: string, deckOrder: string, extra = {}) =>
    new DeckWalker(
        {
            pickOrder: PickOrder[cardOrder as keyof typeof PickOrder],
            deckOrder: DeckOrder[deckOrder as keyof typeof DeckOrder],
            ...extra,
        },
        root,
    );

describe("sequential orders match the golden runs exactly", () => {
    const runs = golden.runs.filter(
        (r: { cardOrder: string; deckOrder: string }) =>
            r.deckOrder === "PrevDeckComplete_Sequential" && r.cardOrder.endsWith("Sequential"),
    );

    test.each(
        runs.map((r: { start: string; cardOrder: string; randomScript: string }) => [
            r.start,
            r.cardOrder,
            r.randomScript,
            r,
        ]),
    )("%s, %s (%s)", (_start, _order, _script, run) => {
        const { root } = fixture();
        const iterator = iteratorFor(root, run.cardOrder, run.deckOrder);
        const seen = walk(iterator, START[run.start as keyof typeof START]);
        expect(seen).toEqual(
            run.returned.map((r: { card: string; deck: string }) => ({
                card: r.card,
                deck: r.deck.replace(/^flashcards\/?/, (m: string) =>
                    m === "flashcards" ? "flashcards" : "flashcards/",
                ),
            })),
        );
        expect(plainTree(root)).toEqual(run.treeAfter);
        expect(iterator.hasCurrentCard).toBe(run.finalHasCurrentCard);
        expect(deckLabel(iterator.currentDeck)).toEqual(run.finalCurrentDeck);
    });
});

describe("random orders are a shuffle fixed by the study day", () => {
    test("the shuffle key is the number cyrb53 writes as hex text", () => {
        for (const text of [
            "",
            "2023-09-06|card-1",
            "2023-09-06|é日本語 \u{1F600}",
            "x".repeat(300),
        ]) {
            expect(shuffleKey(text)).toBe(parseInt(cyrb53(text), 16));
        }
    });

    const orders: [string, string][] = [
        ["NewFirstSequential", "PrevDeckComplete_Random"],
        ["NewFirstRandom", "PrevDeckComplete_Sequential"],
        ["NewFirstRandom", "PrevDeckComplete_Random"],
        ["DueFirstSequential", "PrevDeckComplete_Random"],
        ["DueFirstRandom", "PrevDeckComplete_Sequential"],
        ["DueFirstRandom", "PrevDeckComplete_Random"],
        ["EveryCardRandomDeckAndCard", "PrevDeckComplete_Sequential"],
    ];

    const run = (
        cardOrder: string,
        deckOrder: string,
        daySalt: string,
        start = TopicPath.emptyPath,
    ) => {
        const { root } = fixture();
        return walk(iteratorFor(root, cardOrder, deckOrder, { daySalt }), start);
    };

    test.each(orders)(
        "%s with %s: every card once, and the same on the same day",
        (cardOrder, deckOrder) => {
            const first = run(cardOrder, deckOrder, "2023-09-06");
            expect(first.map((s) => s.card).sort()).toEqual([
                "A1",
                "A2",
                "A3",
                "A4",
                "B1",
                "B2",
                "D1",
                "M1",
                "M2",
            ]);
            expect(run(cardOrder, deckOrder, "2023-09-06")).toEqual(first);
        },
    );

    test.each(orders)("%s with %s: another day gives another order", (cardOrder, deckOrder) => {
        const days = [
            "2023-09-06",
            "2023-09-07",
            "2023-09-08",
            "2023-09-09",
            "2023-09-10",
            "2023-09-11",
        ];
        const orderings = new Set(
            days.map((day) => JSON.stringify(run(cardOrder, deckOrder, day))),
        );
        expect(orderings.size).toBeGreaterThan(1);
    });

    test("the study day is the default salt", () => {
        setupStaticDateProvider("2023-09-06");
        const { root: a } = fixture();
        const viaClock = walk(
            iteratorFor(a, "DueFirstRandom", "PrevDeckComplete_Sequential"),
            TopicPath.emptyPath,
        );
        expect(viaClock).toEqual(
            run("DueFirstRandom", "PrevDeckComplete_Sequential", "2023-09-06"),
        );
        setupStaticDateProvider("2023-09-07");
        const { root: b } = fixture();
        const nextDay = walk(
            iteratorFor(b, "DueFirstRandom", "PrevDeckComplete_Sequential"),
            TopicPath.emptyPath,
        );
        expect(nextDay).toEqual(run("DueFirstRandom", "PrevDeckComplete_Sequential", "2023-09-07"));
    });

    test("a random deck order still finishes a deck before the next, and keeps the list order inside it", () => {
        const seen = run("DueFirstSequential", "PrevDeckComplete_Random", "2023-09-06");
        const blocks: string[][] = [];
        let last: string | null = null;
        for (const step of seen) {
            if (step.deck !== last) blocks.push([]);
            blocks[blocks.length - 1].push(step.card);
            last = step.deck;
        }
        // One block per deck, never two blocks of the same deck
        const decks = [...new Set(seen.map((s) => s.deck))];
        expect(blocks).toHaveLength(decks.length);
        // Inside a deck: the due cards first, then the new ones, each in list order
        const flashcards = blocks[decks.indexOf("flashcards")];
        expect(flashcards).toEqual(["A2", "A4", "A1", "A3"]);
    });

    test("a card in two decks is shown once, and where it is shown depends on the deck order", () => {
        const seen = run("NewFirstSequential", "PrevDeckComplete_Random", "2023-09-06");
        expect(seen.filter((s) => s.card === "M1")).toHaveLength(1);
    });

    test("from a subdeck only that deck is walked, but a card also in another deck leaves it too", () => {
        const { root } = fixture();
        const iterator = iteratorFor(root, "NewFirstRandom", "PrevDeckComplete_Sequential", {
            daySalt: "x",
        });
        const seen = walk(iterator, tag("#flashcards/b"));
        expect(seen.map((s) => s.card).sort()).toEqual(["B1", "B2", "M1", "M2"]);
        expect(plainTree(root)).toMatchObject({
            sub: [
                {
                    sub: [
                        { name: "b" },
                        { name: "c", new: [], due: [] },
                        { name: "d", new: ["D1"] },
                    ],
                },
            ],
        });
    });
});

describe("most at risk first", () => {
    const risks: Record<string, number> = {
        A2: 0.9,
        A4: 0.5,
        B2: 0.2,
        M2: 0.7,
        A1: 0,
        A3: 0,
        B1: 0,
        M1: 0,
        D1: 0,
    };
    const riskOf = (card: Card) => risks[card.front];

    test("the due cards of a deck go from the lowest chance of recall up, new cards keep their order", () => {
        const { root } = fixture();
        const iterator = iteratorFor(root, "DueFirstSequential", "PrevDeckComplete_Sequential", {
            reviewOrder: "mostAtRisk",
            riskOf,
        });
        expect(walk(iterator, TopicPath.emptyPath).map((s) => s.card)).toEqual([
            "A4",
            "A2",
            "A1",
            "A3",
            "B2",
            "M2",
            "B1",
            "M1",
            "D1",
        ]);
    });

    test("with random card order the due cards are still by risk, the new ones shuffled by the day", () => {
        const { root } = fixture();
        const iterator = iteratorFor(root, "DueFirstRandom", "PrevDeckComplete_Sequential", {
            reviewOrder: "mostAtRisk",
            riskOf,
            daySalt: "d",
        });
        const cards = walk(iterator, TopicPath.emptyPath).map((s) => s.card);
        expect(cards.slice(0, 2)).toEqual(["A4", "A2"]);
        expect(cards.indexOf("B2")).toBeLessThan(cards.indexOf("M2"));
    });

    test("across all decks the due cards come first by risk, then the new cards", () => {
        const { root } = fixture();
        const iterator = iteratorFor(
            root,
            "EveryCardRandomDeckAndCard",
            "PrevDeckComplete_Sequential",
            {
                reviewOrder: "mostAtRisk",
                riskOf,
                daySalt: "d",
            },
        );
        const cards = walk(iterator, TopicPath.emptyPath).map((s) => s.card);
        expect(cards.slice(0, 4)).toEqual(["B2", "A4", "M2", "A2"]);
        expect(cards.slice(4).sort()).toEqual(["A1", "A3", "B1", "D1", "M1"]);
    });

    test("equal risk is broken by the day's shuffle, and unreadable risk goes last", () => {
        const first = (salt: string) => {
            const { root } = fixture();
            const iterator = iteratorFor(
                root,
                "DueFirstSequential",
                "PrevDeckComplete_Sequential",
                {
                    reviewOrder: "mostAtRisk",
                    riskOf: (card: Card) => (card.front === "A4" ? NaN : 0.5),
                    daySalt: salt,
                },
            );
            return walk(iterator, TopicPath.emptyPath).map((s) => s.card);
        };
        const seen = first("a");
        expect(seen.slice(0, 2)).toContain("A2");
        expect(seen[1]).toBe("A4");
        expect(new Set(["a", "b", "c", "d", "e"].map((s) => first(s).join())).size).toBeGreaterThan(
            1,
        );
    });

    test("without a risk function the setting changes nothing", () => {
        const { root } = fixture();
        const iterator = iteratorFor(root, "DueFirstSequential", "PrevDeckComplete_Sequential", {
            reviewOrder: "mostAtRisk",
        });
        expect(walk(iterator, TopicPath.emptyPath).map((s) => s.card)).toEqual([
            "A2",
            "A4",
            "A1",
            "A3",
            "B2",
            "M2",
            "B1",
            "M1",
            "D1",
        ]);
    });
});

describe("iterator operations (walker-ops.json)", () => {
    const small = () => {
        const a1 = makeCard("A1", ["#flashcards"]);
        const a2 = makeCard("A2", ["#flashcards"], "due");
        const root = treeOf(a1, a2);
        return { root, a1, a2 };
    };
    const seqIterator = (root: Deck) =>
        new DeckWalker(
            {
                pickOrder: PickOrder.NewFirstSequential,
                deckOrder: DeckOrder.PrevDeckComplete_Sequential,
            },
            root,
        );

    test("getters before and after setting a topic path", () => {
        const { root } = small();
        const it = seqIterator(root);
        expect([it.hasCurrentCard, it.currentReviewItem, it.currentDeck]).toEqual([
            false,
            null,
            null,
        ]);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        expect([it.hasCurrentCard, it.currentReviewItem, it.currentDeck]).toEqual([
            false,
            null,
            null,
        ]);
        expect(it.nextReviewItem()).toBe(true);
        expect(it.currentQuestion).toBe(it.currentReviewItem.question);
        expect(deckLabel(it.currentDeck)).toBe("flashcards");
        expect(it.nextReviewItem()).toBe(true);
        expect(it.nextReviewItem()).toBe(false);
        expect(it.nextReviewItem()).toBe(false);
        expect([it.hasCurrentCard, it.currentDeck]).toEqual([false, null]);
    });

    test("the card shown is taken out of every deck when the next one is asked for", () => {
        const { root } = small();
        const it = seqIterator(root);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        it.nextReviewItem();
        expect(plainTree(root)).toMatchObject({ sub: [{ new: ["A1"], due: ["A2"] }] });
        it.nextReviewItem();
        expect(plainTree(root)).toMatchObject({ sub: [{ new: [], due: ["A2"] }] });
    });

    test("moveCurrentReviewItemToEndOfList: the card goes to the end of the list of its present state", () => {
        const { root, a1 } = small();
        const it = seqIterator(root);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        it.nextReviewItem();
        a1.scheduleInfo = { isDue: () => true } as never;
        it.moveCurrentReviewItemToEndOfList();
        expect(it.hasCurrentCard).toBe(false);
        expect(deckLabel(it.currentDeck)).toBe("flashcards");
        const deck = root.getDeck(tag("#flashcards"));
        expect(deck.newReviewItems).toEqual([]);
        expect(deck.dueReviewItems.map((c) => c.front)).toEqual(["A2", "A1"]);
        expect(it.nextReviewItem() && it.currentReviewItem.front).toBe("A2");
        expect(it.nextReviewItem() && it.currentReviewItem.front).toBe("A1");
    });

    test("only the copy in the deck being walked moves", () => {
        const { root } = fixture();
        const it = seqIterator(root);
        it.setIteratorTopicPath(tag("#flashcards/b"));
        it.nextReviewItem();
        it.nextReviewItem();
        expect(it.currentReviewItem.front).toBe("M1");
        it.moveCurrentReviewItemToEndOfList();
        expect(root.getDeck(tag("#flashcards/b")).newReviewItems.map((c) => c.front)).toEqual([
            "M1",
        ]);
        expect(root.getDeck(tag("#flashcards/c")).newReviewItems.map((c) => c.front)).toEqual([
            "M1",
        ]);
    });

    test("delete and move without a current card throw; delete returns what next returns", () => {
        const { root } = small();
        const it = seqIterator(root);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        expect(() => it.deleteCurrentReviewItemFromAllDecks()).toThrow("no current card");
        expect(() => it.deleteCurrentQuestionFromAllDecks()).toThrow("no current card");
        expect(() => it.moveCurrentReviewItemToEndOfList()).toThrow("no current card");
        it.nextReviewItem();
        expect(it.deleteCurrentReviewItemFromAllDecks()).toBe(true);
        expect(it.currentReviewItem.front).toBe("A2");
    });

    test("deleting the question removes all its cards from all decks", () => {
        const q = questionFor(["#flashcards"]);
        const x = makeCard("X1", [], "new", q);
        const y = makeCard("X2", [], "new", q);
        const other = makeCard("O", ["#flashcards"]);
        const root = treeOf(x, y, other);
        const it = seqIterator(root);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        it.nextReviewItem();
        expect(it.currentReviewItem).toBe(x);
        expect(it.deleteCurrentQuestionFromAllDecks()).toBe(true);
        expect(it.currentReviewItem).toBe(other);
        expect(root.getDeck(tag("#flashcards")).newReviewItems).toEqual([other]);
    });

    test("setCurrentReviewItem finds the card, decks in order and the new list before the due list, and goes on from its deck", () => {
        const { root, cards } = fixture();
        const it = seqIterator(root);
        expect(it.setCurrentReviewItem(cards.M2, TopicPath.emptyPath)).toBe(true);
        expect(it.currentReviewItem).toBe(cards.M2);
        expect(deckLabel(it.currentDeck)).toBe("flashcards/b");
        // The golden run went on in the due list and left b's new cards out (bug 5); they are offered now
        const next = [];
        while (it.nextReviewItem()) next.push(it.currentReviewItem.front);
        expect(next).toEqual(["B1", "M1", "B2", "D1"]);
    });

    test("setCurrentReviewItem: a card that is not there, or outside the topic path, leaves nothing current", () => {
        const { root, cards } = fixture();
        const it = seqIterator(root);
        expect(
            it.setCurrentReviewItem(makeCard("GHOST", ["#flashcards"]), TopicPath.emptyPath),
        ).toBe(false);
        expect([it.hasCurrentCard, it.currentDeck]).toEqual([false, null]);
        expect(it.setCurrentReviewItem(cards.D1, tag("#flashcards/b"))).toBe(false);
        expect(it.hasCurrentCard).toBe(false);
    });
});

describe("the fixed bugs", () => {
    const seq = (root: Deck, order = PickOrder.DueFirstSequential) =>
        new DeckWalker(
            { pickOrder: order, deckOrder: DeckOrder.PrevDeckComplete_Sequential },
            root,
        );

    test("bug 3: a card put at the front while another is shown does not make the wrong card go", () => {
        const a1 = makeCard("A1", ["#flashcards"], "due");
        const a2 = makeCard("A2", ["#flashcards"], "due");
        const root = treeOf(a2);
        const it = seq(root);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        it.nextReviewItem();
        expect(it.currentReviewItem).toBe(a2);
        root.prependReviewItem(a1.question.topicPathList, a1);
        expect(it.nextReviewItem()).toBe(true);
        // A2 was removed, A1 is next (the old code removed A1 and showed A2 again)
        expect(it.currentReviewItem).toBe(a1);
        expect(it.nextReviewItem()).toBe(false);
    });

    test("bug 3: a card taken out of the list behind the iterator's back does not disturb it", () => {
        const cards = ["A1", "A2", "A3"].map((front) => makeCard(front, ["#flashcards"], "due"));
        const root = treeOf(...cards);
        const it = seq(root);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        it.nextReviewItem();
        root.deleteCardFromAllDecks(cards[1], true);
        it.nextReviewItem();
        expect(it.currentReviewItem).toBe(cards[2]);
    });

    test("bug 4: a card whose question names no deck is still taken out where it was drawn", () => {
        const loose = makeCard("X");
        const root = treeOf(loose);
        const it = seq(root);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        expect(it.nextReviewItem()).toBe(true);
        expect(it.nextReviewItem()).toBe(false);
        expect(root.newReviewItems).toEqual([]);
    });

    test("bug 5: after setCurrentReviewItem into the other list, the rest of the preferred list is still offered", () => {
        const n1 = makeCard("N1", ["#flashcards"]);
        const n2 = makeCard("N2", ["#flashcards"]);
        const d1 = makeCard("D1", ["#flashcards"], "due");
        const root = treeOf(n1, n2, d1);
        const it = seq(root, PickOrder.NewFirstSequential);
        expect(it.setCurrentReviewItem(d1, TopicPath.emptyPath)).toBe(true);
        expect(it.nextReviewItem()).toBe(true);
        expect(it.currentReviewItem).toBe(n1);
        expect(it.nextReviewItem()).toBe(true);
        expect(it.currentReviewItem).toBe(n2);
        expect(it.nextReviewItem()).toBe(false);
    });

    test("bug 9: an unknown deck, no base deck, or no topic path yet is no crash", () => {
        const { root } = fixture();
        const it = seq(root);
        it.setIteratorTopicPath(tag("#missing"));
        expect(it.nextReviewItem()).toBe(false);
        const noBase = new DeckWalker(
            {
                pickOrder: PickOrder.NewFirstSequential,
                deckOrder: DeckOrder.PrevDeckComplete_Sequential,
            },
            null,
        );
        noBase.setIteratorTopicPath(TopicPath.emptyPath);
        expect(noBase.nextReviewItem()).toBe(false);
        // No topic path set yet: the whole tree is walked
        const fresh = seq(fixture().root);
        expect(fresh.nextReviewItem()).toBe(true);
    });

    test("bug 9: a shown card that was removed elsewhere is no crash", () => {
        const { root, cards } = fixture();
        const it = seq(root);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        it.nextReviewItem();
        root.deleteCardFromAllDecks(it.currentReviewItem, true);
        expect(() => it.nextReviewItem()).not.toThrow();
        expect(cards.A2).toBeDefined();
    });

    test("bug 10: a deck that was empty when the topic path was set is found when it gets a card", () => {
        const root = treeOf(makeCard("A1", ["#flashcards"]));
        const late = root.getOrCreateDeck(tag("#flashcards/late"));
        const it = seq(root);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        it.nextReviewItem();
        const card = makeCard("L1", ["#flashcards/late"]);
        late.newReviewItems.push(card);
        expect(it.nextReviewItem()).toBe(true);
        expect(it.currentReviewItem).toBe(card);
        expect(deckLabel(it.currentDeck)).toBe("flashcards/late");
    });

    test("bug 10: setBaseDeck starts over on the new tree", () => {
        const first = fixture().root;
        const second = treeOf(makeCard("Z1", ["#flashcards"]));
        const it = seq(first);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        it.nextReviewItem();
        it.setBaseDeck(second);
        expect([it.hasCurrentCard, it.currentDeck]).toEqual([false, null]);
        expect(it.nextReviewItem()).toBe(true);
        expect(it.currentReviewItem.front).toBe("Z1");
        expect(plainTree(first)).toMatchObject({ sub: [{ new: ["A1", "A3"] }] });
    });

    test("after the end, the next call starts again from the first deck and finds cards added meanwhile", () => {
        const { root } = fixture();
        const it = seq(root, PickOrder.NewFirstSequential);
        it.setIteratorTopicPath(tag("#flashcards/b"));
        while (it.nextReviewItem());
        const added = makeCard("A9", ["#flashcards/b"]);
        root.prependReviewItem(added.question.topicPathList, added);
        expect(it.nextReviewItem()).toBe(true);
        expect(it.currentReviewItem).toBe(added);
    });

    test("an unknown card order offers no card", () => {
        const { root } = fixture();
        const it = new DeckWalker(
            { pickOrder: 99 as PickOrder, deckOrder: DeckOrder.PrevDeckComplete_Sequential },
            root,
        );
        expect(it.nextReviewItem()).toBe(false);
    });

    test("deleting the shown card strictly throws when a deck its question names does not hold it", () => {
        const { root, cards } = fixture();
        const it = seq(root, PickOrder.NewFirstSequential);
        it.setIteratorTopicPath(TopicPath.emptyPath);
        it.nextReviewItem();
        root.getDeck(tag("#flashcards")).newReviewItems.shift();
        expect(it.currentReviewItem).toBe(cards.A1);
        expect(() => it.deleteCurrentReviewItemFromAllDecks()).toThrow("not found in deck");
    });
});

describe("speed", () => {
    test("walking 50,000 cards in a random order does not slow down with the number of cards", () => {
        const cards: Card[] = [];
        for (let i = 0; i < 50_000; i++) {
            cards.push(
                makeCard(`C${i}`, [`#flashcards/d${i % 1000}`], i % 3 === 0 ? "due" : "new"),
            );
        }
        const root = treeOf(...cards);
        const started = performance.now();
        const it = new DeckWalker(
            {
                pickOrder: PickOrder.DueFirstRandom,
                deckOrder: DeckOrder.PrevDeckComplete_Random,
                daySalt: "speed",
            },
            root,
        );
        it.setIteratorTopicPath(TopicPath.emptyPath);
        let count = 0;
        while (it.nextReviewItem()) count++;
        expect(count).toBe(50_000);
        expect(performance.now() - started).toBeLessThan(10_000);
    });
});
