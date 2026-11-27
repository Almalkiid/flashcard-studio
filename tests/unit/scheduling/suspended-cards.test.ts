import { emptyCardMeta } from "src/data/card-meta";
import { Card } from "src/data/data-structures/card/flashcard";
import { Question } from "src/data/data-structures/card/question";
import { Deck } from "src/data/decks/deck";
import { TopicPath, TopicPathList } from "src/data/decks/topic-path";
import { parseImageClozeBlock } from "src/occlusion/image-cloze-block";
import { imageClozeCardMarkdown } from "src/occlusion/image-cloze-view";
import { occlusionCardMarkdown } from "src/occlusion/occlusion-view";
import {
    filterSuspended,
    groupByQuestion,
    suspendedCards,
    suspendedCardText,
} from "src/scheduling/suspended-cards";

interface CardOptions {
    front?: string;
    back?: string;
    deck?: string[];
    path?: string;
    suspended?: boolean;
    question?: Question;
}

function makeQuestion(deck: string[], path: string): Question {
    return {
        topicPathList: new TopicPathList(deck.map((p) => new TopicPath(p.split("/")))),
        note: { filePath: path },
    } as unknown as Question;
}

function makeCard(options: CardOptions = {}): Card {
    const meta = emptyCardMeta();
    meta.suspended = options.suspended ?? true;
    const question =
        options.question ??
        makeQuestion(options.deck ?? ["CIA/Part1"], options.path ?? "CIA/Part1.md");
    return new Card({
        question,
        meta,
        front: options.front ?? "front",
        back: options.back ?? "back",
        cardIdx: 0,
    });
}

function treeOf(cards: Card[]): Deck {
    const tree = new Deck("root", null);
    for (const card of cards) tree.appendReviewItem(card.question.topicPathList, card);
    return tree;
}

describe("suspendedCards", () => {
    test("lists only suspended cards", () => {
        const kept = makeCard({ front: "kept" });
        const active = makeCard({ front: "active", suspended: false });
        expect(suspendedCards(treeOf([kept, active]))).toEqual([kept]);
    });

    test("lists a card in two decks once", () => {
        const twoDecks = makeCard({ deck: ["CIA/Part1", "Trivia"] });
        expect(suspendedCards(treeOf([twoDecks]))).toEqual([twoDecks]);
    });
});

describe("filterSuspended", () => {
    const heart = makeCard({
        front: "Heart chambers?",
        back: "Four",
        path: "Bio/Heart.md",
        deck: ["Bio"],
    });
    const audit = makeCard({ front: "What is COSO?", back: "A framework", path: "CIA/Part1.md" });
    const sub = makeCard({
        front: "Risk",
        back: "Impact x likelihood",
        path: "CIA/Part2.md",
        deck: ["CIA/Part2/Risk"],
    });
    const all = [heart, audit, sub];

    test("no query and no deck keeps every card", () => {
        expect(filterSuspended(all, "  ", "")).toEqual(all);
    });

    test("filters by text in front, back or note path, ignoring case", () => {
        expect(filterSuspended(all, "heart", "")).toEqual([heart]);
        expect(filterSuspended(all, "FRAMEWORK", "")).toEqual([audit]);
        expect(filterSuspended(all, "part2.md", "")).toEqual([sub]);
    });

    test("treats regex characters in the query as text", () => {
        const parens = makeCard({ front: "f(x) = x*2" });
        expect(filterSuspended([parens, audit], "(x) = x*", "")).toEqual([parens]);
        expect(filterSuspended([parens, audit], "[", "")).toEqual([]);
    });

    test("filters by deck and its subdecks", () => {
        expect(filterSuspended(all, "", "CIA")).toEqual([audit, sub]);
        expect(filterSuspended(all, "", "CIA/Part2")).toEqual([sub]);
        expect(filterSuspended(all, "risk", "Bio")).toEqual([]);
    });
});

describe("groupByQuestion", () => {
    test("groups two cards of one question together", () => {
        const question = makeQuestion(["CIA"], "CIA/Cloze.md");
        const first = makeCard({ question });
        const second = makeCard({ question });
        const other = makeCard({});
        const groups = groupByQuestion([first, other, second]);
        expect(groups.size).toBe(2);
        expect(groups.get(question)).toEqual([first, second]);
        expect(groups.get(other.question)).toEqual([other]);
    });
});

describe("suspendedCardText", () => {
    const cardWithFront = (front: string) => ({ front }) as Card;

    test("an image cloze card shows its question and hints, not its data", () => {
        const read = parseImageClozeBlock(
            "image: x.png\nquestion: Name it\nmask: 1 | a rect 0 0 .1 .1 | chamber",
        );
        if (!read.ok) throw new Error("not read");
        const front = imageClozeCardMarkdown({
            kind: "cloze",
            block: read.block,
            card: 1,
            side: "front",
            textCards: 0,
        });
        expect(suspendedCardText(cardWithFront(front))).toBe("Name it · chamber");
    });

    test("an image occlusion card shows its question and the label of its mask", () => {
        const block = {
            image: "x.png",
            mode: "hide-all" as const,
            question: "Q",
            masks: [{ id: "a", shape: "rect" as const, x: 0, y: 0, w: 0.1, h: 0.1, label: "A" }],
        };
        expect(suspendedCardText(cardWithFront(occlusionCardMarkdown(block, 0, "front")))).toBe(
            "Q · A",
        );
    });

    test("any other card as before: its text on one line", () => {
        expect(suspendedCardText(cardWithFront("What  is\n**this**?"))).toBe("What is **this**?");
    });
});
