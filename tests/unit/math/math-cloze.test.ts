import { IClozeFormatter } from "clozecraft";
import { readFileSync } from "fs";

import { CardFrontBackUtil } from "src/cards/expand";
import { CardType } from "src/data/data-structures/card/question";
import { StudioSettings } from "src/data/settings-model";
import {
    containsMathCloze,
    legacyClozeCardIndices,
    MATH_CLOZE_PATTERN,
    MATH_CLOZE_TOKEN,
    MathClozeFormatter,
    restoreMathClozes,
    tokenizeMathClozes,
} from "src/math/math-cloze";

import { settingsWith } from "../storage/helpers";

const golden = <T>(name: string): T[] =>
    JSON.parse(readFileSync(`tests/unit/math/golden/${name}.json`, "utf8")) as T[];

type Outcome<T> = { ok: T } | { throws: string };
const BOTH = ["{{[123;;]answer[;;hint]}}", "==[123;;]answer[;;hint]=="];

const cards = (text: string, options: Partial<StudioSettings>) =>
    CardFrontBackUtil.expand(CardType.Cloze, text, settingsWith(options)).map((c) => ({
        front: c.front,
        back: c.back,
    }));

describe("constants", () => {
    test("the pattern and token match the golden constants", () => {
        expect(golden<{ value: string }>("math-cloze-constants")[0].value).toBe(MATH_CLOZE_PATTERN);
        expect(MATH_CLOZE_TOKEN.global).toBe(true);
        expect("a 2x b".match(MATH_CLOZE_TOKEN)).toEqual(["2x"]);
    });
});

describe("containsMathCloze", () => {
    test.each(golden<{ input: string; output: boolean }>("math-cloze-contains"))(
        "$input -> $output",
        ({ input, output }) => {
            expect(containsMathCloze(input)).toBe(output);
        },
    );

    test("an escaped backslash before cloze is not the command, three backslashes are", () => {
        expect(containsMathCloze("\\\\cloze{a}")).toBe(false);
        expect(containsMathCloze("\\\\\\cloze{a}")).toBe(true);
        expect(containsMathCloze("\\\\cloze{a} and \\cloze{b}")).toBe(true);
    });
});

describe("tokenizeMathClozes and restoreMathClozes", () => {
    test.each(
        golden<{
            input: string;
            output: { tokenized: string; clozes: unknown[]; restored: string };
        }>("math-cloze-tokenize"),
    )("$input", ({ input, output }) => {
        const made = tokenizeMathClozes(input);
        expect(made.text).toBe(output.tokenized);
        expect(made.clozes).toEqual(output.clozes);
        expect(restoreMathClozes(made.text, made.clozes)).toBe(output.restored);
    });

    test.each(
        golden<{ input: { text: string; clozesFrom: string }; output: string }>(
            "math-cloze-restore-handbuilt",
        ),
    )("hand-built $input.text", ({ input, output }) => {
        const { clozes } = tokenizeMathClozes("$\\cloze[2]{p}{} + \\cloze{q}{}$");
        expect(restoreMathClozes(input.text, clozes)).toBe(output);
    });

    test("an out-of-range key is left as it is instead of throwing", () => {
        const { clozes } = tokenizeMathClozes("$\\cloze{p}{}$");
        expect(restoreMathClozes("a5b", clozes)).toBe("a5b");
        expect(restoreMathClozes("57", clozes)).toBe("57");
    });
});

describe("expanding cloze cards", () => {
    test.each(
        golden<{
            input: string;
            output: Record<"settingOn" | "settingOff" | "inputsOn", Outcome<unknown>>;
        }>("math-cloze-expand"),
    )("$input", ({ input, output }) => {
        expect({
            settingOn: { ok: cards(input, { latexClozes: true }) },
            settingOff: { ok: cards(input, { latexClozes: false }) },
            inputsOn: {
                ok: cards(input, { latexClozes: true, convertClozePatternsToInputs: true }),
            },
        }).toEqual(output);
    });

    test.each(
        golden<{ input: string; output: Record<"settingOn" | "settingOff", Outcome<unknown>> }>(
            "math-cloze-expand-custom-patterns",
        ),
    )("with both patterns: $input", ({ input, output }) => {
        expect({
            settingOn: { ok: cards(input, { latexClozes: true, clozePatterns: BOTH }) },
            settingOff: { ok: cards(input, { latexClozes: false, clozePatterns: BOTH }) },
        }).toEqual(output);
    });
});

describe("MathClozeFormatter", () => {
    const inner: IClozeFormatter = {
        asking: (answer, hint) => `ASK(${answer ?? ""}|${hint ?? ""})`,
        showingAnswer: (answer, hint) => `SHOW(${answer}|${hint ?? ""})`,
        hiding: (answer, hint) => `HIDE(${answer ?? ""}|${hint ?? ""})`,
    };

    test.each(
        golden<{
            input: { source: string; answerArg: string | null; hintArg: string | null };
            output: Record<"asking" | "showingAnswer" | "hiding", { ok: string }>;
        }>("math-cloze-formatter"),
    )("$input.source with $input.answerArg", ({ input, output }) => {
        const formatter = new MathClozeFormatter(inner, tokenizeMathClozes(input.source).clozes);
        const answer = input.answerArg ?? undefined;
        const hint = input.hintArg ?? undefined;
        expect({
            asking: { ok: formatter.asking(answer, hint) },
            showingAnswer: { ok: formatter.showingAnswer(answer, hint) },
            hiding: { ok: formatter.hiding(answer, hint) },
        }).toEqual(output);
    });
});

describe("legacyClozeCardIndices", () => {
    test.each(
        golden<{ input: { text: string; patterns: string[] }; output: { ok: number[] | null } }>(
            "math-cloze-legacy",
        ),
    )("$input.text", ({ input, output }) => {
        expect({ ok: legacyClozeCardIndices(input.text, input.patterns) }).toEqual(output);
    });
});
