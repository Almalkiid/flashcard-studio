import { imageClozeNoteProblem } from "src/cards/image-cloze-question";
import { NoteQuestionParser } from "src/cards/note-question-parser";
import { CardType, Question } from "src/data/data-structures/card/question";
import { TopicPath } from "src/data/decks/topic-path";
import { bindQuestion, bindSegments, inBindingScope, readBinding } from "src/data/segment-binding";
import { StudioSettings } from "src/data/settings-model";
import { TextDirection } from "src/utils/text";

import { settingsWith, setUp } from "../storage/helpers";
import { UnitTestNoteFile } from "../support/memory-note";

const BLOCK = (...masks: string[]) =>
    ["```image-cloze", "image: x.png", ...masks, "```"].join("\n");
const SR = (...segments: string[]) => `<!--SR:${segments.map((s) => `!${s}`).join("")}-->`;

async function load(text: string, changes: Partial<StudioSettings> = {}): Promise<Question[]> {
    const settings = settingsWith(changes);
    setUp(settings);
    return new NoteQuestionParser(settings).createQuestionList(
        new UnitTestNoteFile(text, "note.md"),
        TextDirection.Ltr,
        // A note is only read with a deck: from its folder here
        new TopicPath(["deck"]),
        false,
    );
}

/** Each card's schedule as written, and its number. */
function cardsOf(question: Question): [string | null, number | null][] {
    return question.cards.map((card) => [
        card.scheduleInfo === null ? null : card.scheduleInfo.formatScheduleAsComment().slice(1),
        card.meta.cardNumber ?? null,
    ]);
}

const stripIds = (text: string) => text.replace(/,id=[0-9a-z]+/g, "");

describe("readBinding", () => {
    test("numbered", () => {
        const binding = readBinding(
            SR("2026-01-01,1,250,c=1", "2026-01-02,1,250,c=2", "2026-01-05,1,250,c=5"),
        );
        expect(binding).toEqual({
            kind: "numbered",
            rawOf: new Map([
                [1, 0],
                [2, 1],
                [5, 2],
            ]),
        });
    });

    test("unnumbered counts raw places, empty pieces included", () => {
        expect(readBinding("<!--SR:!A!!B-->")).toEqual({ kind: "unnumbered", nonEmptyRaw: [0, 2] });
    });

    test.each([
        ["a segment without c=", SR("2026-01-01,1,250,c=2", "2026-01-02,1,250")],
        ["the same number twice", SR("2026-01-01,1,250,c=2", "2026-01-02,1,250,c=2")],
        ["c=0", SR("2026-01-01,1,250,c=0")],
        ["c=01", SR("2026-01-01,1,250,c=01")],
        ["c=x", SR("2026-01-01,1,250,c=x")],
        ["two c= in a segment", SR("2026-01-01,1,250,c=1,c=2")],
        ["an empty segment", "<!--SR:!2026-01-01,1,250,c=1!!2026-01-02,1,250,c=2-->"],
    ])("unreadable: %s", (_name, comment) => {
        expect(readBinding(comment)).toEqual({ kind: "unreadable" });
    });

    test("c=100 is a card number", () => {
        expect(readBinding(SR("2026-01-01,1,250,c=100"))).toEqual({
            kind: "numbered",
            rawOf: new Map([[100, 0]]),
        });
    });

    test("no comment", () => {
        expect(readBinding("text")).toEqual({ kind: "none" });
    });
});

describe("bindSegments", () => {
    test("numbered: each card its own segment; a missing number has none", () => {
        const comment = SR("a,1,250,c=1", "b,1,250,c=2", "e,1,250,c=5");
        expect(bindSegments(comment, [1, 5], 0, null)).toEqual([0, 2]);
        expect(bindSegments(SR("a,1,250,c=1", "e,1,250,c=5"), [1, 2], 2, null)).toEqual([0, null]);
    });

    test("unnumbered: the text's cards by place, cards above them none", () => {
        expect(bindSegments("<!--SR:!A!!B-->", [1, 2], 2, null)).toEqual([0, 2]);
        expect(bindSegments("<!--SR:!A!B!C-->", [1, 5], 1, null)).toEqual([0, null]);
    });

    test("an old math reading that finds no old card gives none", () => {
        expect(bindSegments("<!--SR:!A!B-->", [1, 2], 2, [1, -1])).toEqual([1, null]);
    });
});

describe("scope", () => {
    test("clozes and image clozes with a block or a c= token; nothing else", () => {
        expect(inBindingScope(BLOCK("mask: 1 | a rect 0 0 .1 .1 |"), CardType.ImageCloze)).toBe(
            true,
        );
        expect(inBindingScope(`==1;;a==\n${SR("x,1,250,c=x")}`, CardType.Cloze)).toBe(true);
        expect(inBindingScope(`==1;;a==\n${SR("x,1,250")}`, CardType.Cloze)).toBe(false);
        expect(inBindingScope(`Q::A ${SR("x,1,250,c=3")}`, CardType.SingleLineBasic)).toBe(false);
    });

    test("a cloze with a malformed c= is not a card", () => {
        expect(
            bindQuestion(
                `==1;;a==\n${SR("x,1,250,c=x")}`,
                "==1;;a==",
                CardType.Cloze,
                settingsWith(),
            ),
        ).toBe("unreadable");
    });
});

describe("loading a note", () => {
    test("card 5 loads its schedule from c=5, whatever the order in the comment", async () => {
        const text = `==1;;a== ==2;;b==\n${BLOCK("mask: 5 | m rect 0 0 .1 .1 |")}\n${SR("2026-01-05,5,250,c=5", "2026-01-01,1,250,c=1")}`;
        const [question] = await load(text);
        expect(cardsOf(question)).toEqual([
            ["2026-01-01,1,250", 1],
            [null, 2],
            ["2026-01-05,5,250", 5],
        ]);
        expect(question.hasChanged).toBe(false);
    });

    test("reading never marks a question with a block changed, even with an old comment", async () => {
        const text = `$\\cloze{x}$ ==1;;a==\n${BLOCK("mask: 3 | m rect 0 0 .1 .1 |")}\n<!--SR:!2026-01-01,1,250!2026-01-02,1,250!2026-01-03,1,250-->`;
        const [question] = await load(text, { latexClozes: true });
        expect(question.hasChanged).toBe(false);
    });

    test("an unnumbered comment: empty segments do not shift cards (!A!!B: card 2 is B)", async () => {
        const text = `==1;;a== ==2;;b==\n${BLOCK("mask: 3 | m rect 0 0 .1 .1 |")}\n<!--SR:!2026-01-01,1,250!!2026-01-02,2,250-->`;
        const [question] = await load(text);
        expect(cardsOf(question)).toEqual([
            ["2026-01-01,1,250", 1],
            ["2026-01-02,2,250", 2],
            [null, 3],
        ]);
    });

    test("an unreadable comment: no cards, nothing to write", async () => {
        const text = `==1;;a==\n${BLOCK("mask: 1 | m rect 0 0 .1 .1 |")}\n${SR("2026-01-01,1,250,c=1", "2026-01-01,1,250,c=1")}`;
        const [question] = await load(text);
        expect(question.cards).toEqual([]);
    });

    test("a comment inside a block's hint: no cards, no schedule read", async () => {
        const text = BLOCK("mask: 1 | m rect 0 0 .1 .1 | <!--SR:!2026-01-01,1,250-->");
        const questions = await load(text);
        expect(questions.flatMap((q) => q.cards)).toEqual([]);
        expect(questions.some((q) => q.hasChanged)).toBe(false);
    });

    test("a note without image cloze blocks loads exactly as before", async () => {
        const text = `Q::A ${SR("2026-01-01,1,250,c=3")}\n\n==1;;a== ==2;;b==\n<!--SR:!2026-01-01,1,250!2026-01-02,2,250-->`;
        const [basic, cloze] = await load(text);
        expect(basic.cards[0].meta.extras).toEqual(["c=3"]);
        expect(basic.cards[0].meta).not.toHaveProperty("cardNumber");
        expect(cardsOf(cloze)).toEqual([
            ["2026-01-01,1,250", null],
            ["2026-01-02,2,250", null],
        ]);
        // The writer gives a reviewed card an id, as it always has; c= stays an unknown token where it was
        expect(stripIds(basic.formatForNote(settingsWith()))).toContain(SR("2026-01-01,1,250,c=3"));
    });
});

describe("writing", () => {
    test("segments in ascending card numbers, each with c=, ids kept", async () => {
        const text = `==1;;a== ==2;;b==\n${BLOCK("mask: 5 | m rect 0 0 .1 .1 |")}\n${SR("2026-01-05,5,250,id=abc,c=5", "2026-01-01,1,250,c=1")}`;
        const [question] = await load(text);
        const written = question.formatForNote(settingsWith());
        expect(stripIds(written).split("\n").pop()).toBe(
            "<!--SR:!2026-01-01,1,250,c=1!2000-01-01,1,250,c=2!2026-01-05,5,250,c=5-->",
        );
        expect(written).toContain("c=5,id=abc");
    });

    test("an image cloze question with nothing stored writes no comment", async () => {
        const text = BLOCK("mask: 1 | m rect 0 0 .1 .1 |");
        const [question] = await load(text);
        expect(question.formatForNote(settingsWith())).toBe(text);
    });

    test("a basic card and an image occlusion card with c= in their comments are written back as they were", async () => {
        const occlusion = [
            "```image-occlusion",
            "image: x.png",
            "mask: a rect 0 0 .1 .1 | A",
            "```",
            SR("2026-01-01,1,250,id=abc,c=3"),
        ].join("\n");
        const [question] = await load(occlusion);
        expect(question.formatForNote(settingsWith())).toBe(occlusion);
    });
});

describe("schedules follow card numbers through edits", () => {
    const comment = SR("2026-01-01,1,250,c=1", "2026-01-02,2,250,c=2", "2026-01-05,5,250,c=5");
    const mask5 = "mask: 5 | m rect 0 0 .1 .1 |";

    test("a text cloze 3 added by hand: card 5 keeps its schedule", async () => {
        const [question] = await load(`==1;;a== ==2;;b== ==3;;c==\n${BLOCK(mask5)}\n${comment}`);
        expect(cardsOf(question)).toEqual([
            ["2026-01-01,1,250", 1],
            ["2026-01-02,2,250", 2],
            [null, 3],
            ["2026-01-05,5,250", 5],
        ]);
    });

    test("text cloze 2 removed: card 5 keeps its schedule, 2's is gone at the next write", async () => {
        const [question] = await load(`==1;;a==\n${BLOCK(mask5)}\n${comment}`);
        expect(cardsOf(question)).toEqual([
            ["2026-01-01,1,250", 1],
            ["2026-01-05,5,250", 5],
        ]);
        expect(stripIds(question.formatForNote(settingsWith()))).not.toContain("c=2");
    });

    test("mask 5 deleted and put back before any write: kept", async () => {
        const [without] = await load(
            `==1;;a== ==2;;b==\n${BLOCK("mask: 0 | m rect 0 0 .1 .1 |")}\n${comment}`,
        );
        expect(cardsOf(without).map(([, k]) => k)).toEqual([1, 2]);
        const [back] = await load(`==1;;a== ==2;;b==\n${BLOCK(mask5)}\n${comment}`);
        expect(cardsOf(back)[2]).toEqual(["2026-01-05,5,250", 5]);
    });

    test("1 rewritten as a, and a mask moved or split, keep the numbers' schedules", async () => {
        const one = SR("2026-01-01,1,250,c=1");
        const [letters] = await load(`${BLOCK("mask: a | m rect 0 0 .1 .1 |")}\n${one}`);
        expect(cardsOf(letters)).toEqual([["2026-01-01,1,250", 1]]);
        const [split] = await load(
            `${BLOCK("mask: 2 | m rect .5 .5 .1 .1 |", "mask: 1 | n rect 0 0 .1 .1 |")}\n${one}`,
        );
        expect(cardsOf(split)).toEqual([
            ["2026-01-01,1,250", 1],
            [null, 2],
        ]);
    });

    test("a block added to an unnumbered card 1, renumbered to 2 before the first write: still binds to 1", async () => {
        const [question] = await load(
            `==2;;a==\n${BLOCK("mask: 3 | m rect 0 0 .1 .1 |")}\n<!--SR:!2026-01-01,1,250-->`,
        );
        // T = 2 (classic: up to the highest number); the old segment is the text's first card's
        expect(cardsOf(question)[0]).toEqual(["2026-01-01,1,250", 1]);
    });

    test("the block removed later: a numbered comment stays numbered, a new text cloze 2 is new", async () => {
        const [question] = await load(
            `==1;;a== ==2;;b==\n${SR("2026-01-01,1,250,c=1", "2026-01-05,5,250,c=5")}`,
        );
        expect(cardsOf(question)).toEqual([
            ["2026-01-01,1,250", 1],
            [null, 2],
        ]);
    });
});

describe("what the note view says", () => {
    const s = () => settingsWith();

    test("a block that is never closed", () => {
        expect(imageClozeNoteProblem("```image-cloze\nimage: x.png", 0, s())).toBe(
            "IMAGE_CLOZE_UNCLOSED",
        );
    });

    test("a quoted block that is never closed ends with its quote: the card after it is still a card", () => {
        const text = "> ```image-cloze\n> image: x.png\n\nQ::A";
        expect(imageClozeNoteProblem(text, 0, s())).toBe("IMAGE_CLOZE_UNCLOSED");
    });

    test("a block alone that asks nothing", () => {
        expect(
            imageClozeNoteProblem(
                BLOCK("mask: 0 | m rect 0 0 .1 .1 |", "mask: hs | n rect .5 .5 .1 .1 |"),
                0,
                s(),
            ),
        ).toBe("IMAGE_CLOZE_NOTHING_ASKED");
    });

    test("beside text clozes, masks that are all hidden are fine", () => {
        expect(
            imageClozeNoteProblem(`==1;;a==\n${BLOCK("mask: h | m rect 0 0 .1 .1 |")}`, 1, s()),
        ).toBeNull();
    });

    test("two blocks in one region", () => {
        const regions = settingsWith({
            multilineCardStartMarker: "+++",
            multilineCardEndMarker: "+++",
        });
        const text = [
            "+++",
            "==1;;a==",
            BLOCK("mask: 1 | m rect 0 0 .1 .1 |"),
            BLOCK("mask: 2 | n rect 0 0 .1 .1 |"),
            "+++",
        ].join("\n");
        expect(imageClozeNoteProblem(text, 2, regions)).toBe("IMAGE_CLOZE_TWO_BLOCKS");
    });

    test("a block inside a basic card: nothing to say", () => {
        expect(
            imageClozeNoteProblem(
                `Question\n?\nAnswer\n${BLOCK("mask: 1 | m rect 0 0 .1 .1 |")}`,
                3,
                s(),
            ),
        ).toBeNull();
    });

    test("a schedule comment that cannot be read", () => {
        const text = `${BLOCK("mask: 1 | m rect 0 0 .1 .1 |")}\n${SR("x,1,250,c=1", "y,1,250,c=1")}`;
        expect(imageClozeNoteProblem(text, 0, s())).toBe("IMAGE_CLOZE_BAD_SCHEDULE");
    });

    test("only the block's own question is looked at", () => {
        const text = `${BLOCK("mask: 1 | m rect 0 0 .1 .1 |")}\n\n${BLOCK("mask: 0 | n rect 0 0 .1 .1 |")}`;
        expect(imageClozeNoteProblem(text, 0, s())).toBeNull();
        expect(imageClozeNoteProblem(text, 5, s())).toBe("IMAGE_CLOZE_NOTHING_ASKED");
    });
});
