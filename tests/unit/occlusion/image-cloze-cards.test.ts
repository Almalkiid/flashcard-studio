import { ImageClozeBlock, ImageClozeMask, readCardField } from "src/occlusion/image-cloze-block";
import { actionOf, cardNumbersOf, nextFreeNumber } from "src/occlusion/image-cloze-cards";

function mask(fieldText: string, id = "m"): ImageClozeMask {
    const field = readCardField(fieldText);
    if (field === null) throw new Error(`bad field ${fieldText}`);
    return { id, field, fieldText, shape: "rect", x: 0, y: 0, w: 0.1, h: 0.1, hint: "" };
}

function block(...fields: string[]): ImageClozeBlock {
    return {
        image: "x.png",
        mode: "hide-all",
        question: "",
        masks: fields.map((field, at) => mask(field, `m${at}`)),
    };
}

describe("actionOf", () => {
    test("a number field is asked on its card", () => {
        expect(actionOf(mask("1"), 1, "hide-all")).toBe("a");
        expect(actionOf(mask("1"), 1, "hide-one")).toBe("a");
    });

    test("on another card it is hidden in hide-all and shown in hide-one", () => {
        expect(actionOf(mask("1"), 2, "hide-all")).toBe("h");
        expect(actionOf(mask("1"), 2, "hide-one")).toBe("s");
    });

    test("a list is asked on every card it names", () => {
        expect(actionOf(mask("1,2"), 1, "hide-one")).toBe("a");
        expect(actionOf(mask("1,2"), 2, "hide-one")).toBe("a");
        expect(actionOf(mask("1,2"), 3, "hide-one")).toBe("s");
    });

    test("0 is hidden on every card, in both modes, and never asked", () => {
        for (const k of [1, 2, 7]) {
            expect(actionOf(mask("0"), k, "hide-all")).toBe("h");
            expect(actionOf(mask("0"), k, "hide-one")).toBe("h");
        }
    });

    test("letters give one action per card, and show past their end", () => {
        expect(actionOf(mask("ash"), 1, "hide-all")).toBe("a");
        expect(actionOf(mask("ash"), 2, "hide-all")).toBe("s");
        expect(actionOf(mask("ash"), 3, "hide-all")).toBe("h");
        expect(actionOf(mask("as"), 3, "hide-all")).toBe("s");
        expect(actionOf(mask("as"), 3, "hide-one")).toBe("s");
    });
});

describe("cardNumbersOf", () => {
    test("only the numbers in use: no empty card for a gap", () => {
        expect(cardNumbersOf(0, block("1", "3"))).toEqual([1, 3]);
    });

    test("shared with the text's cards, ascending", () => {
        expect(cardNumbersOf(2, block("5"))).toEqual([1, 2, 5]);
        expect(cardNumbersOf(2, block("1", "2,4"))).toEqual([1, 2, 4]);
    });

    test("nothing asked gives no cards", () => {
        expect(cardNumbersOf(0, block("0", "h", "s", "hs"))).toEqual([]);
    });

    test("a letter field is asked where it has an a", () => {
        expect(cardNumbersOf(0, block("has"))).toEqual([2]);
        expect(cardNumbersOf(0, block("a", "sa", "2"))).toEqual([1, 2]);
    });
});

describe("nextFreeNumber", () => {
    test("the lowest number not in use, text cards counted", () => {
        expect(nextFreeNumber(0, block("1", "3"))).toBe(2);
        expect(nextFreeNumber(2, block("3"))).toBe(4);
        expect(nextFreeNumber(0, block("0"))).toBe(1);
    });

    test("none when 1 to 99 are all in use", () => {
        const all = Array.from({ length: 99 }, (_unused, at) => String(at + 1));
        expect(nextFreeNumber(0, block(...all))).toBeNull();
        expect(nextFreeNumber(99, block("0"))).toBeNull();
    });
});
