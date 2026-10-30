import { IClozeFormatter } from "clozecraft";

import { MathClozeFormatter, tokenizeMathClozes } from "src/math/math-cloze";

const inner: IClozeFormatter = {
    asking: (answer, hint) => `ASK(${answer}|${hint})`,
    showingAnswer: (answer, hint) => `SHOW(${answer}|${hint})`,
    hiding: (answer, hint) => `HIDE(${answer}|${hint})`,
};

function formatterFor(hint: string, inMath = true) {
    const macro = `\\cloze{x^2}{${hint}}`;
    const source = inMath ? `$${macro}$` : macro;
    const { clozes } = tokenizeMathClozes(source);
    expect(clozes).toHaveLength(1);
    expect(clozes[0].hint).toBe(hint);
    return new MathClozeFormatter(inner, clozes);
}

// These are desired compatibility + feature requirements, not snapshots of PR #5.
// Both base and PR intentionally fail some cases until both requirements are met.
describe.each([
    ["asking", "#2196f3"],
    ["hiding", "gray"],
] as const)("%s math hints", (method, colour) => {
    test.each([
        ["", "[\\ldots]"],
        ["   ", "[\\ldots]"],
        ["Pythagoras", "[\\text{Pythagoras}]"],
        ["  spaced hint  ", "[\\text{spaced hint}]"],
        [String.raw`50\%`, String.raw`[\text{50\%}]`],
        [String.raw`a\&b`, String.raw`[\text{a\&b}]`],
        [String.raw`file\_name`, String.raw`[\text{file\_name}]`],
        [String.raw`\{label\}`, String.raw`[\text{\{label\}}]`],
    ])("preserves text/empty hint %j", (hint, expected) => {
        const formatter = formatterFor(hint);
        expect(formatter[method]("0", "")).toBe(`{\\color{${colour}}{${expected}}}`);
    });

    test.each([
        "x^{?}",
        "a_b",
        String.raw`\frac{a}{b}`,
        String.raw`\text{solve for }x^{?}`,
        String.raw`\text{spaced hint}`,
    ])("allows explicit TeX content %j", (hint) => {
        const formatter = formatterFor(hint);
        expect(formatter[method]("0", "")).toBe(`{\\color{${colour}}{[${hint}]}}`);
    });
});

test("revealed answer stays raw math regardless of the hint", () => {
    expect(formatterFor("spaced hint").showingAnswer("0", "")).toBe("{\\color{#2196f3}{x^2}}");
});

test("outside math, the original formatter receives the text hint", () => {
    expect(formatterFor("  spaced hint  ", false).asking("0", "")).toBe("ASK(x^2|spaced hint)");
});
