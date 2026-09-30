import {
    EXAM_PRESETS,
    ExamAnswer,
    ExamCardInput,
    examEndMs,
    examKeyAction,
    ExamQuestion,
    ExamSetup,
    examSummary,
    examTypedTarget,
    formatClock,
    formatCountdown,
    isAnswered,
    isRight,
    joinDeckNames,
    missedCardIds,
    pickExamQuestions,
    plainExcerpt,
    remainingMs,
    scoreExam,
} from "src/exam/exam";
import { occlusionCardMarkdown } from "src/occlusion/occlusion-view";

// Two decks, five cards: a single answer question, a several answer one, a short typed one, a long one (self
// marked) and a cloze card, which an exam never asks
const CHOICE_BACK =
    "- [ ] The CAE\n- [x] The board\n- [ ] External auditors\nThe board approves it.";
const MULTI_BACK = "- [x] Management\n- [x] Risk and compliance\n- [ ] The audit committee";

function card(overrides: Partial<ExamCardInput> & { id: string }): ExamCardInput {
    return {
        deck: "CIA/Part1",
        front: `Question ${overrides.id}`,
        back: "Chief Audit Executive",
        isCloze: false,
        suspended: false,
        ...overrides,
    };
}

const CARDS: ExamCardInput[] = [
    card({ id: "c1", deck: "CIA/Part1", front: "Who approves the charter?", back: CHOICE_BACK }),
    card({ id: "c2", deck: "CIA/Part1", front: "Which are lines of defence?", back: MULTI_BACK }),
    card({ id: "c3", deck: "CIA/Part2", front: "What does CAE stand for?" }),
    card({
        id: "c4",
        deck: "CIA/Part2",
        front: "Explain independence",
        back: "Freedom from conditions that threaten objectivity.\nIt is organisational and individual.",
    }),
    card({ id: "c5", deck: "CIA/Part2", front: "The CAE reports to the ==board==", isCloze: true }),
];

const SETUP: ExamSetup = {
    decks: [],
    count: 10,
    minutes: null,
    filter: "all",
    passPercent: 75,
    title: "Exam · CIA",
};

/** Always the same number, so the shuffle is the same on every run: [a, b, c, d] becomes [b, c, d, a]. */
const ZERO = () => 0;

/** A random number generator that repeats the same sequence for the same seed (mulberry32). */
function seeded(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function ids(questions: ExamQuestion[]): string[] {
    return questions.map((q) => q.cardId);
}

describe("EXAM_PRESETS", () => {
    test("Quick check is 20 questions without a limit and the CIA simulation 125 questions in 150 minutes", () => {
        expect(EXAM_PRESETS).toEqual([
            { id: "quick", count: 20, minutes: null },
            { id: "cia", count: 125, minutes: 150 },
        ]);
    });
});

describe("pickExamQuestions", () => {
    test("choice-only keeps the cards whose answer is multiple choice", () => {
        const picked = pickExamQuestions(CARDS, { ...SETUP, filter: "choice-only" }, ZERO);
        expect(ids(picked).sort()).toEqual(["c1", "c2"]);
        expect(picked.every((q) => q.kind === "choice" && q.choice !== null)).toBe(true);
    });

    test("all adds typed questions for short plain answers and self-marked ones for the rest", () => {
        const picked = pickExamQuestions(CARDS, SETUP, ZERO);
        const kinds = Object.fromEntries(picked.map((q) => [q.cardId, q.kind]));
        expect(kinds).toEqual({ c1: "choice", c2: "choice", c3: "typed", c4: "self" });
    });

    test("suspended cards and cloze cards are never asked", () => {
        const suspended = card({ id: "s1", back: CHOICE_BACK, suspended: true });
        const picked = pickExamQuestions([...CARDS, suspended], SETUP, ZERO);
        expect(ids(picked)).not.toContain("s1");
        expect(ids(picked)).not.toContain("c5");
    });

    test("asking for more questions than there are cards gives the cards there are", () => {
        expect(pickExamQuestions(CARDS, { ...SETUP, count: 125 }, ZERO)).toHaveLength(4);
    });

    test("takes only as many questions as asked for", () => {
        expect(pickExamQuestions(CARDS, { ...SETUP, count: 2 }, ZERO)).toHaveLength(2);
    });

    test("a question keeps what the exam needs to show and mark it", () => {
        const picked = pickExamQuestions(
            [
                card({
                    id: "c1",
                    front: "Who approves the charter?",
                    back: CHOICE_BACK,
                    sourcePath: "CIA/Charter.md",
                }),
            ],
            SETUP,
            ZERO,
        );
        expect(picked).toHaveLength(1);
        expect(picked[0]).toMatchObject({
            cardId: "c1",
            deck: "CIA/Part1",
            kind: "choice",
            front: "Who approves the charter?",
            back: CHOICE_BACK,
            sourcePath: "CIA/Charter.md",
        });
        expect(picked[0].choice?.options.map((option) => option.text)).toEqual([
            "The CAE",
            "The board",
            "External auditors",
        ]);
    });

    test("the same random numbers give the same exam, in the order the shuffle puts them", () => {
        // [c1, c2, c3, c4] shuffled with zeros is [c2, c3, c4, c1]
        expect(ids(pickExamQuestions(CARDS, SETUP, ZERO))).toEqual(["c2", "c3", "c4", "c1"]);
        const first = pickExamQuestions(CARDS, SETUP, seeded(7));
        const second = pickExamQuestions(CARDS, SETUP, seeded(7));
        expect(second).toEqual(first);
        expect(ids(first).sort()).toEqual(["c1", "c2", "c3", "c4"]);
    });

    test("another seed gives another order", () => {
        const orders = new Set(
            [1, 2, 3, 4, 5, 6].map((seed) =>
                ids(pickExamQuestions(CARDS, SETUP, seeded(seed))).join(),
            ),
        );
        expect(orders.size).toBeGreaterThan(1);
    });

    test("a choice question has its options in a shuffled order, other questions have none", () => {
        const picked = pickExamQuestions(CARDS, SETUP, seeded(3));
        for (const q of picked) {
            if (q.kind === "choice") {
                expect([...q.order].sort()).toEqual(
                    Array.from({ length: q.choice?.options.length ?? 0 }, (_, i) => i),
                );
            } else {
                expect(q.order).toEqual([]);
            }
        }
    });

    test("options stay in the order written when the setup says not to shuffle them", () => {
        const picked = pickExamQuestions(CARDS, { ...SETUP, shuffleOptions: false }, seeded(3));
        const choices = picked.filter((q) => q.kind === "choice");
        expect(choices.length).toBeGreaterThan(0);
        for (const q of choices) {
            expect(q.order).toEqual(
                Array.from({ length: q.choice?.options.length ?? 0 }, (_, i) => i),
            );
        }
    });

    test("only the chosen decks, with their subdecks, are asked", () => {
        const onlyPart2 = pickExamQuestions(CARDS, { ...SETUP, decks: ["CIA/Part2"] }, ZERO);
        expect(ids(onlyPart2).sort()).toEqual(["c3", "c4"]);
        const wholeCourse = pickExamQuestions(CARDS, { ...SETUP, decks: ["CIA"] }, ZERO);
        expect(ids(wholeCourse)).toHaveLength(4);
        // "CIA/Part" is not the deck "CIA/Part1"
        expect(pickExamQuestions(CARDS, { ...SETUP, decks: ["CIA/Part"] }, ZERO)).toEqual([]);
    });

    test("a card that sits in two chosen decks is asked once", () => {
        const twice = [
            card({ id: "d1", deck: "CIA/Part1", back: CHOICE_BACK }),
            card({ id: "d1", deck: "CIA/Part2", back: CHOICE_BACK }),
        ];
        const picked = pickExamQuestions(
            twice,
            { ...SETUP, decks: ["CIA/Part1", "CIA/Part2"] },
            ZERO,
        );
        expect(ids(picked)).toEqual(["d1"]);
        expect(picked[0].deck).toBe("CIA/Part1");
    });
});

describe("isRight", () => {
    const [single, multi, typed, self] = pickExamQuestions(
        CARDS.filter((c) => c.id !== "c5"),
        { ...SETUP, shuffleOptions: false },
        () => 0.999999,
    ).sort((a, b) => a.cardId.localeCompare(b.cardId));

    function answer(overrides: Partial<ExamAnswer>): ExamAnswer {
        return { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0, ...overrides };
    }

    test("the questions are the ones expected", () => {
        expect([single.cardId, multi.cardId, typed.cardId, self.cardId]).toEqual([
            "c1",
            "c2",
            "c3",
            "c4",
        ]);
    });

    test("a single answer question is right when the right option is chosen", () => {
        expect(isRight(single, answer({ chosen: [1] }), false)).toBe(true);
        expect(isRight(single, answer({ chosen: [0] }), false)).toBe(false);
    });

    test("a several answer question needs exactly the right options: all or nothing", () => {
        expect(isRight(multi, answer({ chosen: [0, 1] }), false)).toBe(true);
        expect(isRight(multi, answer({ chosen: [1, 0] }), false)).toBe(true);
        expect(isRight(multi, answer({ chosen: [0] }), false)).toBe(false);
        expect(isRight(multi, answer({ chosen: [0, 1, 2] }), false)).toBe(false);
    });

    test("no option chosen is unanswered, not wrong", () => {
        expect(isRight(single, answer({}), false)).toBeNull();
    });

    test("a typed answer is right when it matches ignoring case, spacing and a closing full stop", () => {
        expect(isRight(typed, answer({ typed: "  chief   audit executive. " }), false)).toBe(true);
        expect(isRight(typed, answer({ typed: "Chief Audit Exec" }), false)).toBe(false);
        expect(isRight(typed, answer({ typed: "   " }), false)).toBeNull();
        expect(isRight(typed, answer({ typed: "" }), false)).toBeNull();
    });

    test("accents count unless the setting ignores them", () => {
        const cafe: ExamQuestion = { ...typed, back: "café", typedTarget: "café" };
        expect(isRight(cafe, answer({ typed: "cafe" }), false)).toBe(false);
        expect(isRight(cafe, answer({ typed: "cafe" }), true)).toBe(true);
    });

    test("a self-marked question is what the person said", () => {
        expect(isRight(self, answer({ selfRight: true }), false)).toBe(true);
        expect(isRight(self, answer({ selfRight: false }), false)).toBe(false);
        expect(isRight(self, answer({}), false)).toBeNull();
    });
});

describe("isAnswered", () => {
    const base: ExamQuestion = {
        cardId: "x",
        deck: "CIA",
        kind: "choice",
        front: "",
        back: "",
        choice: null,
        order: [],
        sourcePath: "",
    };
    const empty: ExamAnswer = { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0 };

    test("an answer is an option chosen, text typed, or a self mark", () => {
        expect(isAnswered({ ...base, kind: "choice" }, { ...empty, chosen: [2] })).toBe(true);
        expect(isAnswered({ ...base, kind: "choice" }, empty)).toBe(false);
        expect(isAnswered({ ...base, kind: "typed" }, { ...empty, typed: "x" })).toBe(true);
        expect(isAnswered({ ...base, kind: "typed" }, { ...empty, typed: "  " })).toBe(false);
        expect(isAnswered({ ...base, kind: "self" }, { ...empty, selfRight: false })).toBe(true);
        expect(isAnswered({ ...base, kind: "self" }, empty)).toBe(false);
    });
});

describe("scoreExam", () => {
    const questions = pickExamQuestions(CARDS, { ...SETUP, shuffleOptions: false }, ZERO);
    // [c2, c3, c4, c1]: a several answer question, a typed one, a self-marked one, a single answer one
    const empty: ExamAnswer = { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0 };
    const answers: ExamAnswer[] = [
        { ...empty, chosen: [0, 1], ms: 4000 }, // c2 right
        { ...empty, typed: "chief audit executive", ms: 6000 }, // c3 right
        { ...empty, selfRight: false, ms: 9000, flagged: true }, // c4 wrong
        empty, // c1 not answered
    ];
    const start = Date.parse("2026-09-30T14:00:00Z");
    const end = Date.parse("2026-09-30T14:05:00Z");

    test("the questions are the ones expected", () => {
        expect(ids(questions)).toEqual(["c2", "c3", "c4", "c1"]);
    });

    test("counts the right answers, and an unanswered question as wrong", () => {
        const result = scoreExam(SETUP, questions, answers, start, end, false);
        expect(result.right).toBe(2);
        expect(result.total).toBe(4);
        expect(result.percent).toBe(50);
        expect(result.passed).toBe(false);
        expect(result.items.map((item) => item.right)).toEqual([true, true, false, null]);
    });

    test("passes when the percentage reaches the pass mark", () => {
        expect(
            scoreExam({ ...SETUP, passPercent: 50 }, questions, answers, start, end, false).passed,
        ).toBe(true);
        expect(
            scoreExam({ ...SETUP, passPercent: 51 }, questions, answers, start, end, false).passed,
        ).toBe(false);
    });

    test("the percentage is a whole number", () => {
        const three = questions.slice(0, 3);
        const result = scoreExam(SETUP, three, answers.slice(0, 3), start, end, false);
        expect(result.right).toBe(2);
        expect(result.percent).toBe(67);
    });

    test("scores each deck", () => {
        const result = scoreExam(SETUP, questions, answers, start, end, false);
        expect(result.perDeck).toEqual([
            { deck: "CIA/Part1", right: 1, total: 2 },
            { deck: "CIA/Part2", right: 1, total: 2 },
        ]);
    });

    test("keeps the setup, the times and every question with its answer", () => {
        const result = scoreExam(SETUP, questions, answers, start, end, false);
        expect(result.setup).toEqual(SETUP);
        expect(result.startedMs).toBe(start);
        expect(result.endedMs).toBe(end);
        expect(result.items[2].q.cardId).toBe("c4");
        expect(result.items[2].a).toEqual(answers[2]);
    });

    test("an exam without questions scores nothing rather than dividing by zero", () => {
        const result = scoreExam(SETUP, [], [], start, end, false);
        expect(result).toMatchObject({
            right: 0,
            total: 0,
            percent: 0,
            passed: false,
            perDeck: [],
        });
    });

    test("a question without an answer record counts as unanswered", () => {
        const result = scoreExam(SETUP, questions, answers.slice(0, 1), start, end, false);
        expect(result.right).toBe(1);
        expect(result.items[3].right).toBeNull();
    });

    test("the cards to study again are every one not answered right, once each", () => {
        const result = scoreExam(SETUP, questions, answers, start, end, false);
        expect(missedCardIds(result)).toEqual(["c4", "c1"]);
    });
});

describe("clock and deck names", () => {
    test("formatClock shows minutes and seconds, and hours when there are any", () => {
        expect(formatClock(0)).toBe("0:00");
        expect(formatClock(59_999)).toBe("0:59");
        expect(formatClock(299_000)).toBe("4:59");
        expect(formatClock(3_600_000)).toBe("1:00:00");
        expect(formatClock(150 * 60_000)).toBe("2:30:00");
        expect(formatClock(-5000)).toBe("0:00");
    });

    test("remainingMs counts down from the start, or is null without a time limit", () => {
        expect(remainingMs({ ...SETUP, minutes: 150 }, 1_000, 1_000 + 60_000)).toBe(149 * 60_000);
        expect(remainingMs({ ...SETUP, minutes: 1 }, 0, 90_000)).toBe(0);
        expect(remainingMs(SETUP, 0, 90_000)).toBeNull();
    });

    test("deck names are joined for a title, the first three and a count of the rest", () => {
        expect(joinDeckNames(["CIA"])).toBe("CIA");
        expect(joinDeckNames(["CIA", "Arabic"])).toBe("CIA, Arabic");
        expect(joinDeckNames(["A", "B", "C", "D", "E"])).toBe("A, B, C +2");
        expect(joinDeckNames([])).toBe("");
    });
});

describe("plainExcerpt", () => {
    test("drops the Markdown around words, keeping the words", () => {
        expect(
            plainExcerpt(
                "**Who** approves the [[Charter|audit charter]] in `IIA` (see [Standard 6.2](https://x.y))?",
            ),
        ).toBe("Who approves the audit charter in IIA (see Standard 6.2)?");
        expect(plainExcerpt("## Heading\n> quoted [[Note]] text")).toBe("Heading quoted Note text");
    });

    test("leaves out images and joins lines with single spaces", () => {
        expect(plainExcerpt("Look at ![[heart.png]] and ![diagram](a.png)\n\nname the part")).toBe(
            "Look at and name the part",
        );
        expect(plainExcerpt("![[heart.png]]")).toBe("");
    });

    test("is cut at the length asked for, on a word, with an ellipsis", () => {
        expect(plainExcerpt("one two three four five", 12)).toBe("one two…");
        expect(plainExcerpt("short", 12)).toBe("short");
    });
});

describe("the typed answer is worked out once, when the question is picked", () => {
    const picked = pickExamQuestions(
        [
            card({ id: "t1", back: "**Chief** Audit Executive" }),
            card({ id: "s1", back: "Two lines\nof answer" }),
        ],
        { ...SETUP, shuffleOptions: false },
        () => 0.999999,
    );

    test("a typed question keeps the plain text to type, a self-marked one has none", () => {
        expect(picked.find((q) => q.cardId === "t1")).toMatchObject({
            kind: "typed",
            typedTarget: "Chief Audit Executive",
        });
        expect(picked.find((q) => q.cardId === "s1")).toMatchObject({
            kind: "self",
            typedTarget: null,
        });
    });

    test("isRight compares with that text, not with the answer as written", () => {
        const q = picked.find((candidate) => candidate.cardId === "t1");
        const empty: ExamAnswer = { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0 };
        expect(isRight(q, { ...empty, typed: "chief audit executive" }, false)).toBe(true);
        // "**Chief** Audit Executive" is not what anyone types
        expect(isRight(q, { ...empty, typed: "**Chief** Audit Executive" }, false)).toBe(false);
    });

    test("a typed question without a target (an old file) is never right, and is unanswered when empty", () => {
        const q = picked.find((candidate) => candidate.cardId === "t1");
        const noTarget: ExamQuestion = { ...q, typedTarget: undefined };
        const empty: ExamAnswer = { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0 };
        expect(isRight(noTarget, { ...empty, typed: "Chief Audit Executive" }, false)).toBe(false);
        expect(isRight(noTarget, empty, false)).toBeNull();
    });
});

describe("occlusion cards in an exam", () => {
    const mask = { id: "a", shape: "rect" as const, x: 0, y: 0, w: 0.1, h: 0.1 };
    const block = (label: string) => ({
        image: "[[Heart.png]]",
        mode: "hide-all" as const,
        question: "Name the chamber",
        masks: [{ ...mask, label }],
    });
    const occlusion = (id: string, label: string): ExamCardInput =>
        card({
            id,
            front: occlusionCardMarkdown(block(label), 0, "front"),
            back: occlusionCardMarkdown(block(label), 0, "back"),
        });

    test("examTypedTarget is the label of the mask for an occlusion card, the plain answer for another", () => {
        expect(examTypedTarget(occlusionCardMarkdown(block("Left **ventricle**"), 0, "back"))).toBe(
            "Left ventricle",
        );
        expect(examTypedTarget("**Chief** Audit Executive")).toBe("Chief Audit Executive");
        expect(examTypedTarget(occlusionCardMarkdown(block(""), 0, "back"))).toBeNull();
        expect(examTypedTarget("Two lines\nof answer")).toBeNull();
    });

    test("is typed when the label is short plain text, and self-marked when it is not", () => {
        const picked = pickExamQuestions(
            [
                occlusion("o1", "Left ventricle"),
                occlusion("o2", ""),
                occlusion("o3", "x".repeat(130)),
            ],
            { ...SETUP, shuffleOptions: false },
            () => 0.999999,
        );
        const byId = Object.fromEntries(picked.map((q) => [q.cardId, q]));
        expect(byId.o1).toMatchObject({ kind: "typed", typedTarget: "Left ventricle" });
        expect(byId.o2).toMatchObject({ kind: "self", typedTarget: null });
        expect(byId.o3).toMatchObject({ kind: "self", typedTarget: null });
    });

    test("is marked by what was typed against the label, ignoring case and a full stop", () => {
        const [q] = pickExamQuestions([occlusion("o1", "Left ventricle")], SETUP, () => 0);
        const empty: ExamAnswer = { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0 };
        expect(isRight(q, { ...empty, typed: "left ventricle." }, false)).toBe(true);
        expect(isRight(q, { ...empty, typed: "right atrium" }, false)).toBe(false);
    });

    test("a multiple choice only exam leaves occlusion cards out", () => {
        expect(
            pickExamQuestions(
                [occlusion("o1", "Left ventricle")],
                { ...SETUP, filter: "choice-only" },
                () => 0,
            ),
        ).toEqual([]);
    });

    test("plainExcerpt never prints the fence of a code block or of an occlusion card", () => {
        const front = occlusionCardMarkdown(block("Left ventricle"), 0, "front");
        expect(plainExcerpt(front)).toBe("");
        expect(plainExcerpt("Before\n```js\nconst a = 1;\n```\nAfter")).toBe("Before After");
        expect(plainExcerpt("Unclosed ```fence text")).toBe("Unclosed fence text");
    });
});

describe("examKeyAction", () => {
    test("the arrows move, Enter goes on", () => {
        expect(examKeyAction({ key: "ArrowRight", code: "ArrowRight" })).toEqual({ kind: "next" });
        expect(examKeyAction({ key: "ArrowLeft", code: "ArrowLeft" })).toEqual({
            kind: "previous",
        });
        expect(examKeyAction({ key: "Enter", code: "Enter" })).toEqual({ kind: "enter" });
        expect(examKeyAction({ key: "Enter", code: "NumpadEnter" })).toEqual({ kind: "enter" });
    });

    test("F flags on a Latin layout", () => {
        expect(examKeyAction({ key: "f", code: "KeyF" })).toEqual({ kind: "flag" });
        expect(examKeyAction({ key: "F", code: "KeyF" })).toEqual({ kind: "flag" });
    });

    test("F flags on an Arabic layout, where the key gives another letter", () => {
        expect(examKeyAction({ key: "ب", code: "KeyF" })).toEqual({ kind: "flag" });
    });

    test("the digits choose by the key, not by the character, so AZERTY and the numpad work", () => {
        expect(examKeyAction({ key: "1", code: "Digit1" })).toEqual({
            kind: "choose",
            position: 0,
        });
        // AZERTY's unshifted number row gives symbols
        expect(examKeyAction({ key: "&", code: "Digit1" })).toEqual({
            kind: "choose",
            position: 0,
        });
        expect(examKeyAction({ key: "é", code: "Digit2" })).toEqual({
            kind: "choose",
            position: 1,
        });
        expect(examKeyAction({ key: "9", code: "Numpad9" })).toEqual({
            kind: "choose",
            position: 8,
        });
        // Arabic-Indic digits
        expect(examKeyAction({ key: "٣", code: "Digit3" })).toEqual({
            kind: "choose",
            position: 2,
        });
    });

    test("zero, other keys, and a letter typed on the wrong key do nothing", () => {
        expect(examKeyAction({ key: "0", code: "Digit0" })).toBeNull();
        expect(examKeyAction({ key: "x", code: "KeyX" })).toBeNull();
        expect(examKeyAction({ key: "f", code: "KeyG" })).toBeNull();
        expect(examKeyAction({ key: "1", code: "" })).toBeNull();
    });

    test("a shortcut with Ctrl, Cmd or Alt is not the exam's", () => {
        expect(examKeyAction({ key: "f", code: "KeyF", ctrlKey: true })).toBeNull();
        expect(examKeyAction({ key: "f", code: "KeyF", metaKey: true })).toBeNull();
        expect(examKeyAction({ key: "1", code: "Digit1", altKey: true })).toBeNull();
        expect(examKeyAction({ key: "ArrowRight", code: "ArrowRight", ctrlKey: true })).toBeNull();
    });
});

describe("the clock", () => {
    test("the countdown rounds up, so 150 minutes read 2:30:00 and the last second 0:01", () => {
        expect(formatCountdown(150 * 60_000)).toBe("2:30:00");
        expect(formatCountdown(150 * 60_000 - 10)).toBe("2:30:00");
        expect(formatCountdown(149 * 60_000 + 59_001)).toBe("2:30:00");
        expect(formatCountdown(149 * 60_000 + 59_000)).toBe("2:29:59");
        expect(formatCountdown(1)).toBe("0:01");
        expect(formatCountdown(0)).toBe("0:00");
        expect(formatCountdown(-5)).toBe("0:00");
    });

    test("an exam ends at the deadline at the latest, even when it is submitted after a sleep", () => {
        const timed = { ...SETUP, minutes: 150 };
        const started = 1_000_000;
        expect(examEndMs(timed, started, started + 60_000)).toBe(started + 60_000);
        expect(examEndMs(timed, started, started + 150 * 60_000)).toBe(started + 150 * 60_000);
        expect(examEndMs(timed, started, started + 400 * 60_000)).toBe(started + 150 * 60_000);
        // No limit, no deadline
        expect(examEndMs(SETUP, started, started + 400 * 60_000)).toBe(started + 400 * 60_000);
    });
});

describe("examSummary", () => {
    test("is what the home's Last exam card shows", () => {
        const questions = pickExamQuestions(CARDS, { ...SETUP, shuffleOptions: false }, ZERO);
        const start = Date.parse("2026-09-30T14:00:00Z");
        const result = scoreExam(SETUP, questions, [], start, start + 7.5 * 60_000, false);
        expect(examSummary(result)).toEqual({
            title: "Exam · CIA",
            percent: 0,
            right: 0,
            total: 4,
            minutes: 7.5,
            endedMs: start + 7.5 * 60_000,
            passed: false,
        });
    });
});
