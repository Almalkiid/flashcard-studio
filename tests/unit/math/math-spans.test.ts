import { readFileSync } from "fs";

import { findMathSpans, maskMath, splitMath } from "src/math/math-spans";

const golden = <T>(name: string): T[] =>
    JSON.parse(readFileSync(`tests/unit/math/golden/${name}.json`, "utf8")) as T[];

describe("findMathSpans: golden rows", () => {
    test.each(golden<{ input: string; output: unknown[] }>("math-spans-find"))(
        "$input",
        ({ input, output }) => {
            const found = findMathSpans(input).map((s) => ({
                ...s,
                text: input.slice(s.start, s.end),
            }));
            expect(found).toEqual(output);
        },
    );
});

describe("splitMath: golden rows", () => {
    test.each(golden<{ input: string; output: unknown }>("math-spans-split"))(
        "$input",
        ({ input, output }) => {
            expect(splitMath(input)).toEqual(output);
        },
    );

    test.each(
        golden<{
            input: { text: string; spans: { start: number; end: number }[] };
            output: unknown;
        }>("math-spans-split-explicit"),
    )("explicit spans on $input.text", ({ input, output }) => {
        expect(splitMath(input.text, input.spans)).toEqual(output);
    });
});

describe("maskMath: golden rows", () => {
    interface Row {
        input: { text: string; keepPattern: string | null };
        output: {
            masked: string;
            restoreOfMasked: string;
            restoreOfForeign: string;
            restoreOfInnerPlaceholder: string;
            restoreOfUnknownIndex: { ok: string };
        };
    }
    test.each(golden<Row>("math-spans-mask"))(
        "$input.text with keep $input.keepPattern",
        ({ input, output }) => {
            const keep = input.keepPattern ? new RegExp(input.keepPattern, "g") : undefined;
            const { masked, restore } = maskMath(input.text, keep);
            expect(masked).toBe(output.masked);
            expect(restore(masked)).toBe(output.restoreOfMasked);
            expect(restore("zz" + masked.slice(0, 1))).toBe(output.restoreOfForeign);
            expect(restore("0")).toBe(output.restoreOfInnerPlaceholder);
            expect(restore("99")).toBe(output.restoreOfUnknownIndex.ok);
        },
    );
});

describe("rulings", () => {
    test("restore leaves a placeholder it does not know as it is, never the word undefined", () => {
        const { restore } = maskMath("see $x$ here");
        expect(restore("99")).toBe("99");
        expect(restore("a 99 b 0")).toBe("a 99 b $x$");
    });

    test("with no formula, restore is the identity", () => {
        const { masked, restore } = maskMath("plain {{c}}");
        expect(masked).toBe("plain {{c}}");
        expect(restore("0")).toBe("0");
    });

    test("the keep regexp is not consumed by masking", () => {
        const keep = /KEEP\d/g;
        const first = maskMath("$a KEEP1 b$", keep).masked;
        expect(maskMath("$a KEEP1 b$", keep).masked).toBe(first);
        expect(keep.lastIndex).toBe(0);
    });

    test("a zero-length keep match cannot hang the mask", () => {
        expect(maskMath("$ab$", /x*/g).masked).toBe("0");
    });
});

describe("findMathSpans: structure", () => {
    test("offsets count UTF-16 units, so astral characters before a formula shift them by two", () => {
        expect(findMathSpans("\u{1F600} $x$")).toEqual([{ start: 3, end: 6 }]);
    });

    test("an unclosed fence swallows the rest of the text", () => {
        expect(findMathSpans("```\n$x$\n$y$")).toEqual([]);
    });

    test("a longer closing fence closes, a shorter one does not", () => {
        expect(findMathSpans("````\n```\n$x$\n`````\n$y$")).toEqual([{ start: 19, end: 22 }]);
    });

    test("a tilde fence is not closed by backticks", () => {
        expect(findMathSpans("~~~\n```\n$x$")).toEqual([]);
    });

    test("splitMath keeps the length and the newlines", () => {
        const text = "a $b\nc$ d\n$$\ne\n$$ \u{1F600}";
        const { textOnly, mathOnly } = splitMath(text);
        expect(textOnly).toHaveLength(text.length);
        expect(mathOnly).toHaveLength(text.length);
        expect(textOnly.split("\n")).toHaveLength(text.split("\n").length);
    });
});
