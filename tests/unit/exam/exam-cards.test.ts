import { emptyCardMeta } from "src/data/card-meta";
import { Card } from "src/data/data-structures/card/card";
import { CardType, Question } from "src/data/data-structures/card/questions/question";
import { Deck } from "src/data/data-structures/deck/deck";
import { TopicPath, TopicPathList } from "src/data/data-structures/deck/topic-path";
import { collectExamCards } from "src/exam/exam-cards";
import { cardKey } from "src/scheduling/custom-study";

interface Options {
    id?: string;
    decks?: string[];
    front?: string;
    back?: string;
    type?: CardType;
    suspended?: boolean;
    path?: string;
    isNew?: boolean;
}

function makeCard(options: Options = {}): Card {
    const meta = emptyCardMeta();
    meta.id = options.id ?? null;
    meta.suspended = options.suspended ?? false;
    const paths = (options.decks ?? ["CIA/Part1"]).map((path) => new TopicPath(path.split("/")));
    const question = {
        topicPathList: new TopicPathList(paths),
        questionType: options.type ?? CardType.MultiLineBasic,
        note: { filePath: options.path ?? "CIA/Part1.md" },
        questionText: { textHash: "h" + (options.id ?? "x") },
    } as unknown as Question;
    return new Card({
        question,
        meta,
        front: options.front ?? "Front",
        back: options.back ?? "Back",
        cardIdx: 0,
    });
}

function treeOf(cards: Card[]): Deck {
    const tree = new Deck("root", null);
    for (const card of cards) tree.appendRepItem(card.question.topicPathList, card);
    return tree;
}

describe("collectExamCards", () => {
    test("lists a card with its text, its deck path and the note it is in", () => {
        const card = makeCard({
            id: "a1",
            front: "Who approves the charter?",
            back: "- [x] The board\n- [ ] The CAE",
            path: "CIA/Charter.md",
        });
        expect(collectExamCards(treeOf([card]))).toEqual([
            {
                id: "a1",
                deck: "CIA/Part1",
                front: "Who approves the charter?",
                back: "- [x] The board\n- [ ] The CAE",
                isCloze: false,
                suspended: false,
                sourcePath: "CIA/Charter.md",
            },
        ]);
    });

    test("marks cloze and suspended cards so the exam can leave them out", () => {
        const cards = collectExamCards(
            treeOf([
                makeCard({ id: "c1", type: CardType.Cloze }),
                makeCard({ id: "s1", suspended: true }),
            ]),
        );
        expect(cards.find((card) => card.id === "c1")?.isCloze).toBe(true);
        expect(cards.find((card) => card.id === "s1")?.suspended).toBe(true);
    });

    test("a card in two decks comes once for each, under one id", () => {
        const cards = collectExamCards(
            treeOf([makeCard({ id: "t1", decks: ["CIA/Part1", "Trivia"] })]),
        );
        expect(cards.map((card) => [card.id, card.deck]).sort()).toEqual([
            ["t1", "CIA/Part1"],
            ["t1", "Trivia"],
        ]);
    });

    test("a card that has no id yet is named by where it is written, as custom study names it", () => {
        const fresh = makeCard({ path: "CIA/New.md" });
        const [listed] = collectExamCards(treeOf([fresh]));
        expect(listed.id).toBe(cardKey(fresh));
        expect(listed.id).toContain("CIA/New.md");
    });

    test("an empty tree has no cards", () => {
        expect(collectExamCards(new Deck("root", null))).toEqual([]);
    });
});
