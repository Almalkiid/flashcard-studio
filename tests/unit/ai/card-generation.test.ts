import {
    buildGenerationPrompt,
    formatGeneratedCard,
    freeFlashcardsNotePath,
    insertFlashcardsSection,
    linesToOptions,
    newFlashcardsNoteText,
    optionsToLines,
    parseGeneratedCards,
    stripFrontmatter,
    stripScheduleComments,
} from "src/ai/card-generation";
import { DEFAULT_SETTINGS } from "src/data/settings";

test("parses JSON in prose and fences, keeping valid cards only", () => {
    const text =
        'Here you go:\n```json\n{"cards":[{"kind":"basic","front":"Q","back":"A"},{"kind":"basic","front":"","back":"x"},{"kind":"choice","front":"Pick","back":"","options":[{"text":"a","correct":true}]}]}\n```';
    expect(parseGeneratedCards(text)).toEqual([{ kind: "basic", front: "Q", back: "A" }]);
});

test("no valid card is a format error", () => {
    expect(() => parseGeneratedCards("sorry, I can't")).toThrow();
    expect(() => parseGeneratedCards('{"cards":[{"kind":"basic","front":"Q"')).toThrow(); // truncated
});

test("formats every kind in the note's syntax", () => {
    const s = DEFAULT_SETTINGS;
    expect(formatGeneratedCard({ kind: "basic", front: "Q", back: "A" }, s)).toBe("Q::A");
    expect(formatGeneratedCard({ kind: "basic", front: "Q", back: "A\nB" }, s)).toBe("Q\n?\nA\nB");
    expect(formatGeneratedCard({ kind: "reversed", front: "Q", back: "A" }, s)).toBe("Q:::A");
    expect(
        formatGeneratedCard(
            {
                kind: "choice",
                front: "Who?",
                back: "",
                options: [
                    { text: "X", correct: false },
                    { text: "Y", correct: true },
                ],
                explanation: "Because.",
            },
            s,
        ),
    ).toBe("Who?\n?\n- [ ] X\n- [x] Y\nExplanation: Because.");
    expect(
        formatGeneratedCard({ kind: "cloze", front: "The {{board}} approves it", back: "" }, s),
    ).toMatch(/==board==|\*\*board\*\*|\{\{board\}\}/);
});

describe("parseGeneratedCards", () => {
    const card = (extra: object = {}) => ({ kind: "basic", front: "Q", back: "A", ...extra });

    test("accepts a bare array", () => {
        expect(parseGeneratedCards(JSON.stringify([card()]))).toHaveLength(1);
    });

    test("finds the JSON when prose around it has braces", () => {
        const text = `Sure {as asked}. ${JSON.stringify({ cards: [card()] })} Hope [that] helps.`;
        expect(parseGeneratedCards(text)).toEqual([{ kind: "basic", front: "Q", back: "A" }]);
    });

    test("code inside a card does not end the JSON early", () => {
        const back = "```ts\nconst x = { a: [1] };\n```";
        const text = "```json\n" + JSON.stringify({ cards: [card({ back })] }) + "\n```";
        expect(parseGeneratedCards(text)[0].back).toBe(back);
    });

    test("keeps the complete cards of a reply that was cut off", () => {
        const full = JSON.stringify({ cards: [card(), card({ front: "Q2" })] });
        const cut = full.slice(0, full.length - 20);
        const cards = parseGeneratedCards(cut);
        expect(cards.map((c) => c.front)).toEqual(["Q"]);
    });

    test("drops choice cards without two options or without a correct one", () => {
        const options = (...flags: boolean[]) =>
            flags.map((correct, i) => ({ text: `o${i}`, correct }));
        const choice = (o: object[]) => ({ kind: "choice", front: "Pick", back: "", options: o });
        expect(
            parseGeneratedCards(JSON.stringify([choice(options(true, false)), card()])),
        ).toHaveLength(2);
        expect(() =>
            parseGeneratedCards(JSON.stringify([choice(options(false, false))])),
        ).toThrow();
        expect(() => parseGeneratedCards(JSON.stringify([choice(options(true))]))).toThrow();
        expect(() =>
            parseGeneratedCards(JSON.stringify([{ kind: "choice", front: "Pick" }])),
        ).toThrow();
    });

    test("keeps a choice card's options and explanation, dropping an empty explanation", () => {
        const raw = {
            kind: "choice",
            front: "Pick",
            options: [
                { text: " a ", correct: true },
                { text: "b", correct: false },
            ],
            explanation: "  ",
        };
        expect(parseGeneratedCards(JSON.stringify([raw]))).toEqual([
            {
                kind: "choice",
                front: "Pick",
                back: "",
                options: [
                    { text: "a", correct: true },
                    { text: "b", correct: false },
                ],
            },
        ]);
    });

    test("drops cloze cards without a {{marker}}", () => {
        expect(() =>
            parseGeneratedCards(JSON.stringify([{ kind: "cloze", front: "no marker", back: "" }])),
        ).toThrow();
        expect(() =>
            parseGeneratedCards(JSON.stringify([{ kind: "cloze", front: "empty {{}}", back: "" }])),
        ).toThrow();
        expect(
            parseGeneratedCards(JSON.stringify([{ kind: "cloze", front: "a {{b}} c" }])),
        ).toHaveLength(1);
    });

    test("understands kind spellings and a missing kind", () => {
        const kinds = [
            "Multiple choice",
            "multiple_choice",
            "MCQ",
            "Reverse",
            "cloze",
            undefined,
        ].map((kind) => ({
            kind,
            front: "a {{b}}",
            back: "x",
            options: [
                { text: "1", correct: true },
                { text: "2", correct: false },
            ],
        }));
        expect(parseGeneratedCards(JSON.stringify(kinds)).map((c) => c.kind)).toEqual([
            "choice",
            "choice",
            "choice",
            "reversed",
            "cloze",
            "basic",
        ]);
    });

    test("drops a card of an unknown kind", () => {
        expect(() => parseGeneratedCards(JSON.stringify([card({ kind: "essay" })]))).toThrow();
    });

    test("ignores values that are not strings", () => {
        expect(() =>
            parseGeneratedCards(JSON.stringify([card({ front: 5 }), card({ back: null })])),
        ).toThrow();
    });

    test("removes a schedule comment the model copied from the source", () => {
        const cards = parseGeneratedCards(
            JSON.stringify([card({ back: "A <!--SR:!2026-01-01,3,250-->" })]),
        );
        expect(cards[0].back).toBe("A");
    });

    test("an empty list is a format error naming the problem", () => {
        expect(() => parseGeneratedCards('{"cards":[]}')).toThrow(/usable cards/);
    });
});

describe("formatGeneratedCard", () => {
    const s = DEFAULT_SETTINGS;
    const fmt = (card: Parameters<typeof formatGeneratedCard>[0], settings = s) =>
        formatGeneratedCard(card, settings);

    test("reversed cards that need several lines use ??", () => {
        expect(fmt({ kind: "reversed", front: "Q", back: "A\nB" })).toBe("Q\n??\nA\nB");
    });

    test("a separator inside the text forces the multi-line form", () => {
        expect(fmt({ kind: "basic", front: "Ratio a::b", back: "A" })).toBe("Ratio a::b\n?\nA");
        expect(fmt({ kind: "basic", front: "Q", back: "x ::: y" })).toBe("Q\n?\nx ::: y");
    });

    test("uses the configured separators", () => {
        const custom = { ...s, singleLineCardSeparator: ";;", multilineCardSeparator: "==>" };
        expect(fmt({ kind: "basic", front: "Q", back: "A" }, custom)).toBe("Q;;A");
        expect(fmt({ kind: "basic", front: "Q", back: "A\nB" }, custom)).toBe("Q\n==>\nA\nB");
    });

    test("a blank line would end a card, so blank lines inside are removed", () => {
        expect(fmt({ kind: "basic", front: "Q", back: "A\n\n\nB" })).toBe("Q\n?\nA\nB");
        expect(fmt({ kind: "basic", front: "Q1\n\nQ2", back: "A" })).toBe("Q1\nQ2\n?\nA");
    });

    test("surrounding space is trimmed and line endings are normalised", () => {
        expect(fmt({ kind: "basic", front: "  Q \r\n", back: " A " })).toBe("Q::A");
    });

    test("cloze uses the first enabled pattern", () => {
        const only = (pattern: string) => ({ ...s, clozePatterns: [pattern] });
        const card = { kind: "cloze" as const, front: "The {{board}} and {{CAE}}", back: "" };
        expect(fmt(card)).toBe("The ==board== and ==CAE==");
        expect(fmt(card, only("**[123;;]answer[;;hint]**"))).toBe("The **board** and **CAE**");
        expect(fmt(card, only("{{[123;;]answer[;;hint]}}"))).toBe("The {{board}} and {{CAE}}");
        expect(fmt(card, { ...s, clozePatterns: [] })).toBe("The {{board}} and {{CAE}}");
        expect(
            fmt(card, {
                ...s,
                clozePatterns: ["==[123;;]answer[;;hint]==", "**[123;;]answer[;;hint]**"],
            }),
        ).toBe("The ==board== and ==CAE==");
    });

    test("cloze drops the Anki numbering a model may add", () => {
        expect(fmt({ kind: "cloze", front: "The {{c1::board}} approves", back: "" })).toBe(
            "The ==board== approves",
        );
    });

    test("choice options stay on one line each", () => {
        const out = fmt({
            kind: "choice",
            front: "Pick\none",
            back: "",
            options: [
                { text: "a\nb", correct: true },
                { text: "c", correct: false },
            ],
        });
        expect(out).toBe("Pick\none\n?\n- [x] a b\n- [ ] c");
    });

    test("choice explanation keeps its lines but no blank ones", () => {
        const out = fmt({
            kind: "choice",
            front: "Pick",
            back: "",
            options: [
                { text: "a", correct: true },
                { text: "b", correct: false },
            ],
            explanation: "One.\n\nTwo.",
        });
        expect(out.endsWith("- [ ] b\nExplanation: One.\nTwo.")).toBe(true);
    });
});

describe("buildGenerationPrompt", () => {
    const options = {
        count: 7,
        kinds: ["basic" as const, "choice" as const],
        instructions: "Focus on definitions",
        sourceText: "Intro\nThe board approves the charter.\n<!--SR:!2026-01-01,3,250-->\n",
        noteTitle: "Governance",
    };

    test("asks for JSON only, the count, the chosen kinds and the extra instructions", () => {
        const p = buildGenerationPrompt(options);
        expect(p.system).toContain("JSON");
        expect(p.system).toContain("7");
        expect(p.system).toContain("basic");
        expect(p.system).toContain("choice");
        expect(p.system).not.toContain("reversed");
        expect(p.system).toContain("Focus on definitions");
        expect(p.maxTokens).toBeGreaterThan(1000);
    });

    test("puts the note in the user message without schedule comments", () => {
        const p = buildGenerationPrompt(options);
        expect(p.user).toContain("Governance");
        expect(p.user).toContain("The board approves the charter.");
        expect(p.user).not.toContain("<!--SR:");
    });

    test("leaves out the instructions section when there are none", () => {
        expect(buildGenerationPrompt({ ...options, instructions: "  " }).system).not.toContain(
            "Additional instructions",
        );
    });

    test("allows more output for more cards, within a ceiling", () => {
        const small = buildGenerationPrompt({ ...options, count: 1 }).maxTokens;
        const large = buildGenerationPrompt({ ...options, count: 50 }).maxTokens;
        expect(large).toBeGreaterThan(small);
        expect(large).toBeLessThanOrEqual(8192);
    });
});

describe("source text helpers", () => {
    test("stripFrontmatter removes only a leading block", () => {
        expect(stripFrontmatter("---\ntags: x\n---\nBody\n---\nrule")).toBe("Body\n---\nrule");
        expect(stripFrontmatter("Body\n---\nx\n---\n")).toBe("Body\n---\nx\n---\n");
        expect(stripFrontmatter("---\nno end")).toBe("---\nno end");
    });

    test("stripScheduleComments removes the comment and the line it leaves empty", () => {
        expect(stripScheduleComments("Q::A <!--SR:!2026-01-01,3,250-->\nnext")).toBe("Q::A\nnext");
        expect(stripScheduleComments("Q\n?\nA\n<!--SR:!2026-01-01,3,250-->\nnext")).toBe(
            "Q\n?\nA\nnext",
        );
        expect(stripScheduleComments("<!-- a normal comment -->")).toBe(
            "<!-- a normal comment -->",
        );
    });
});

describe("writing cards into a note", () => {
    const cards = "Q::A\n\nQ2::A2";

    test("creates the Flashcards section, with the tag on top, at the end of the note", () => {
        expect(insertFlashcardsSection("# Title\n\nText\n", cards, "#flashcards")).toBe(
            "# Title\n\nText\n\n## Flashcards\n\n#flashcards\n\nQ::A\n\nQ2::A2\n",
        );
    });

    test("does not add a tag when none is asked for", () => {
        expect(insertFlashcardsSection("Text", cards, null)).toBe(
            "Text\n\n## Flashcards\n\nQ::A\n\nQ2::A2\n",
        );
    });

    test("appends to the end of an existing Flashcards section", () => {
        const note = "Text\n\n## Flashcards\n\nOld::card\n";
        expect(insertFlashcardsSection(note, cards, null)).toBe(
            "Text\n\n## Flashcards\n\nOld::card\n\nQ::A\n\nQ2::A2\n",
        );
    });

    test("inserts before the next heading when the section is not last", () => {
        const note = "## Flashcards\n\nOld::card\n\n## Notes\n\nMore\n";
        expect(insertFlashcardsSection(note, cards, null)).toBe(
            "## Flashcards\n\nOld::card\n\nQ::A\n\nQ2::A2\n\n## Notes\n\nMore\n",
        );
    });

    test("a deeper heading inside the section does not end it", () => {
        const note = "## Flashcards\n\n### Set one\n\nOld::card\n";
        expect(insertFlashcardsSection(note, cards, null)).toBe(
            "## Flashcards\n\n### Set one\n\nOld::card\n\nQ::A\n\nQ2::A2\n",
        );
    });

    test("does not mistake the heading inside a code block", () => {
        const note = "```\n## Flashcards\n```\n";
        expect(insertFlashcardsSection(note, cards, null)).toBe(
            "```\n## Flashcards\n```\n\n## Flashcards\n\nQ::A\n\nQ2::A2\n",
        );
    });

    test("an empty note gets just the section", () => {
        expect(insertFlashcardsSection("", cards, null)).toBe("## Flashcards\n\nQ::A\n\nQ2::A2\n");
    });

    test("a tag goes above the new cards, also in a section that exists", () => {
        const note = "## Flashcards\n\nOld::card\n";
        expect(insertFlashcardsSection(note, cards, "#flashcards")).toBe(
            "## Flashcards\n\nOld::card\n\n#flashcards\n\nQ::A\n\nQ2::A2\n",
        );
    });

    test("a new note starts with the tag", () => {
        expect(newFlashcardsNoteText(cards, "#flashcards")).toBe("#flashcards\n\nQ::A\n\nQ2::A2\n");
        expect(newFlashcardsNoteText(cards, null)).toBe("Q::A\n\nQ2::A2\n");
    });
});

describe("freeFlashcardsNotePath", () => {
    test("names the note next to the source, numbering when the name is taken", () => {
        expect(freeFlashcardsNotePath("CIA", "Governance", () => false)).toBe(
            "CIA/Governance - flashcards.md",
        );
        expect(freeFlashcardsNotePath("", "Governance", () => false)).toBe(
            "Governance - flashcards.md",
        );
        const taken = new Set([
            "CIA/Governance - flashcards.md",
            "CIA/Governance - flashcards 2.md",
        ]);
        expect(freeFlashcardsNotePath("CIA", "Governance", (p) => taken.has(p))).toBe(
            "CIA/Governance - flashcards 3.md",
        );
    });
});

describe("editing choice options as text", () => {
    test("shows one [x] or [ ] line per option", () => {
        expect(
            optionsToLines([
                { text: "The board", correct: true },
                { text: "The CAE", correct: false },
            ]),
        ).toBe("[x] The board\n[ ] The CAE");
    });

    test("reads the lines back, accepting list dashes, capital X and lines without a marker", () => {
        expect(linesToOptions("[x] A\n- [ ] B\n* [X] C\nD\n\n   \n[ ]   \n")).toEqual([
            { text: "A", correct: true },
            { text: "B", correct: false },
            { text: "C", correct: true },
            { text: "D", correct: false },
        ]);
    });

    test("round-trips", () => {
        const options = [
            { text: "One", correct: false },
            { text: "Two", correct: true },
        ];
        expect(linesToOptions(optionsToLines(options))).toEqual(options);
    });
});
