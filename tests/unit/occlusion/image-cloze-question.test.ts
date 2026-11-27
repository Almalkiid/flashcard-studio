import { CardFrontBackUtil } from "src/cards/expand";
import {
    expandImageCloze,
    hasImageClozeBlock,
    readImageClozeQuestion,
    swapImageClozeFences,
} from "src/cards/image-cloze-question";
import { CardType } from "src/data/data-structures/card/question";
import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import { parseOcclusionCardSpec } from "src/occlusion/occlusion-view";

const CARD = /```fs-image-cloze-card\n(.*)\n```/;

function settings(changes: Partial<StudioSettings> = {}): StudioSettings {
    return { ...cloneDefaultSettings(), ...changes };
}

function block(...masks: string[]): string {
    return ["```image-cloze", "image: x.png", ...masks, "```"].join("\n");
}

/** The spec of a card side as an object, and the side's text with the spec block taken out. */
function split(side: string): { spec: Record<string, unknown> | null; text: string } {
    const match = CARD.exec(side);
    return {
        spec: match === null ? null : (JSON.parse(match[1]) as Record<string, unknown>),
        text: match === null ? side : side.replace(match[0], "<IMG>"),
    };
}

const cardNumbers = (text: string, s = settings()) =>
    expandImageCloze(text, s).map((card) => card.cardNumber);

describe("text and image share card numbers", () => {
    const text = `The ==1;;a== and ==2;;b==.\n${block("mask: 1 | m1 rect 0 0 .1 .1 | one", "mask: 5 | m5 rect .5 .5 .1 .1 |")}`;

    test("cards 1, 2 and 5", () => {
        expect(cardNumbers(text)).toEqual([1, 2, 5]);
    });

    test("card 1 asks text cloze 1 and its mask", () => {
        const card = expandImageCloze(text, settings())[0];
        const front = split(card.front);
        expect(front.text).toContain("[...]");
        expect(front.text).toContain(" and b.");
        expect(front.spec).toMatchObject({ kind: "cloze", card: 1, side: "front", textCards: 2 });
        expect(split(card.back).spec).toMatchObject({ card: 1, side: "back" });
    });

    test("card 5 shows both text clozes as answers", () => {
        const card = expandImageCloze(text, settings())[2];
        const front = split(card.front);
        expect(front.text).toBe("The a and b.\n<IMG>");
        expect(front.spec).toMatchObject({ card: 5 });
    });

    test("the cloze handler sends a cloze with a block here", () => {
        const cards = CardFrontBackUtil.expand(CardType.Cloze, text, settings());
        expect(cards.map((card) => card.cardNumber)).toEqual([1, 2, 5]);
    });
});

test("a gap in the text's numbers still makes its card, as text clozes do", () => {
    expect(cardNumbers(`==1;;a== ==3;;c==\n${block("mask: 1 | m rect 0 0 .1 .1 |")}`)).toEqual([
        1, 2, 3,
    ]);
});

test("overlapping text clozes: card k is position k", () => {
    const text = `==ash;;x== and ==sa;;y==\n${block("mask: 1 | m rect 0 0 .1 .1 |")}`;
    const cards = expandImageCloze(text, settings());
    expect(cards.map((card) => card.cardNumber)).toEqual([1, 2, 3]);
    expect(split(cards[0].front).text).toContain("[...]");
    expect(split(cards[0].front).spec).toMatchObject({ card: 1 });
});

test("plain clozes keep clozecraft's order: by pattern, then by place", () => {
    const s = settings({
        clozePatterns: ["{{[123::]answer[::hint]}}", "==[123;;]answer[;;hint]=="],
    });
    const text = `==late== then {{early}}\n${block("mask: 3 | m rect 0 0 .1 .1 |")}`;
    const cards = expandImageCloze(text, s);
    expect(cards.map((card) => card.cardNumber)).toEqual([1, 2, 3]);
    // Card 1 asks {{early}}: its pattern comes first; ==late== is shown as written
    expect(split(cards[0].front).text).toContain("late then ");
    expect(split(cards[0].front).text).toContain("[...]");
});

describe("what is inside a block is never a text cloze", () => {
    test.each([
        ["==9;;x==", {}],
        ["{{9::x}}", { clozePatterns: ["{{[123::]answer[::hint]}}", "==[123;;]answer[;;hint]=="] }],
        ["\\cloze[9]{x}", { latexClozes: true }],
    ])("a hint %p", (hint, changes) => {
        const s = settings(changes);
        const text = `==1;;a==\n${block(`mask: 1 | m rect 0 0 .1 .1 | ${hint}`)}`;
        expect(cardNumbers(text, s)).toEqual([1]);
    });

    test.each([false, true])(
        "an indented or quoted block in a cloze (latexClozes %p)",
        (latexClozes) => {
            const s = settings({ latexClozes });
            const plain = "Text ==1;;a== here.";
            const expected = CardFrontBackUtil.expand(CardType.Cloze, plain, s).length;
            for (const fence of [
                ["  ```image-cloze", "  mask: 1 | m rect 0 0 .1 .1 | ==9;;x==", "  ```"],
                ["> ```image-cloze", "> mask: 1 | m rect 0 0 .1 .1 | ==9;;x==", "> ```"],
            ]) {
                const text = [plain, ...fence].join("\n");
                const cards = CardFrontBackUtil.expand(CardType.Cloze, text, s);
                expect(cards).toHaveLength(expected);
                expect(cards[0].front).toContain(fence[1]);
            }
        },
    );
});

describe("a block alone", () => {
    test("only the numbers in use", () => {
        const text = block("mask: 1 | a rect 0 0 .1 .1 |", "mask: 3 | b rect .5 .5 .1 .1 |");
        expect(cardNumbers(text)).toEqual([1, 3]);
        const cards = CardFrontBackUtil.expand(CardType.ImageCloze, text, settings());
        expect(cards.map((card) => card.cardNumber)).toEqual([1, 3]);
        expect(split(cards[1].front).spec).toMatchObject({ card: 3, textCards: 0 });
    });

    test("nothing asked: no cards", () => {
        expect(
            cardNumbers(block("mask: 0 | a rect 0 0 .1 .1 |", "mask: hs | b rect .5 .5 .1 .1 |")),
        ).toEqual([]);
    });

    test("numbers and letters together", () => {
        expect(
            cardNumbers(block("mask: 2 | a rect 0 0 .1 .1 |", "mask: a | b rect .5 .5 .1 .1 |")),
        ).toEqual([1, 2]);
    });

    test("plain text with it is shown as written", () => {
        const text = `Label the heart:\n${block("mask: 1 | a rect 0 0 .1 .1 |")}`;
        expect(split(expandImageCloze(text, settings())[0].front).text).toBe(
            "Label the heart:\n<IMG>",
        );
    });
});

describe("questions that are not cards", () => {
    test("two blocks", () => {
        const text = `${block("mask: 1 | a rect 0 0 .1 .1 |")}\n${block("mask: 2 | b rect 0 0 .1 .1 |")}`;
        expect(readImageClozeQuestion(text, settings())).toMatchObject({
            ok: false,
            problem: "two-blocks",
        });
        expect(expandImageCloze(text, settings())).toEqual([]);
    });

    test("an unclosed block", () => {
        const text = "==1;;a==\n```image-cloze\nimage: x.png\nmask: 1 | a rect 0 0 .1 .1 |";
        expect(readImageClozeQuestion(text, settings())).toMatchObject({
            ok: false,
            problem: "unclosed",
            line: 1,
        });
        expect(expandImageCloze(text, settings())).toEqual([]);
    });

    test("a line that cannot be read is named by its line in the question", () => {
        const text = `==1;;a==\n${block("mask: x | a rect 0 0 .1 .1 |")}`;
        expect(readImageClozeQuestion(text, settings())).toEqual({
            ok: false,
            problem: "field",
            line: 3,
        });
    });

    test("no block at the left edge: not an image cloze question", () => {
        expect(readImageClozeQuestion("==1;;a==", settings())).toBeNull();
        expect(hasImageClozeBlock("  ```image-cloze\n  ```")).toBe(false);
        expect(hasImageClozeBlock(block("mask: 1 | a rect 0 0 .1 .1 |"))).toBe(true);
    });
});

test("typed answers: inputs for the text clozes only", () => {
    const s = settings({ convertClozePatternsToInputs: true });
    const text = `==1;;a== ==2;;b==\n${block("mask: 1 | m rect 0 0 .1 .1 | one", "mask: 3 | n rect .5 .5 .1 .1 |")}`;
    const cards = expandImageCloze(text, s);
    expect(split(cards[0].front).text).toContain('class="cloze-input"');
    expect(split(cards[0].front).spec).not.toBeNull();
    expect(JSON.stringify(split(cards[0].front).spec)).not.toContain("input");
    // Card 3 is the picture's only: the text shows its answers, with no field to type in
    expect(split(cards[2].front).text).toBe("a b\n<IMG>");
});

describe("a card above the text's cards shows every text cloze", () => {
    test("overlap h letters and math", () => {
        const text = `==ha;;x== $x^2$\n${block("mask: 4 | m rect 0 0 .1 .1 |")}`;
        const cards = expandImageCloze(text, settings());
        const last = split(cards[cards.length - 1].front).text;
        expect(last).toBe("x $x^2$\n<IMG>");
        expect(last).not.toContain("<input");
    });

    test("math clozes, latexClozes on", () => {
        const s = settings({ latexClozes: true });
        const text = `$\\cloze[1]{a}{h}$ and $\\cloze[ha]{b}$\n${block("mask: 5 | m rect 0 0 .1 .1 |")}`;
        const cards = expandImageCloze(text, s);
        const last = split(cards[cards.length - 1].front).text;
        expect(last).toBe("$a$ and $b$\n<IMG>");
    });
});

test("swapImageClozeFences keeps the line count and finds every block", () => {
    const text = `a\n  \`\`\`image-cloze\n  x\n  \`\`\`\n${block("mask: 1 | m rect 0 0 .1 .1 |")}`;
    const { swapped, fences } = swapImageClozeFences(text);
    expect(swapped.split("\n")).toHaveLength(text.split("\n").length);
    expect(fences).toEqual([
        { start: 1, end: 3, owning: false },
        { start: 4, end: 7, owning: true },
    ]);
    expect(swapped).not.toContain("image-cloze");
});

test("an old image occlusion card spec still reads through its own path", () => {
    const json = JSON.stringify({
        block: {
            image: "x.png",
            mode: "hide-all",
            question: "",
            masks: [{ id: "a", shape: "rect", x: 0, y: 0, w: 0.1, h: 0.1, label: "A" }],
        },
        active: 0,
        side: "front",
    });
    expect(parseOcclusionCardSpec(json)).not.toBeNull();
});
