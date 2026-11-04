import type { App, RequestUrlParam } from "obsidian";

import { meaningChecker } from "src/ai/ai-access";
import { AiRequestFn } from "src/ai/ai-provider";
import { cloneDefaultSettings } from "src/data/settings-model";
import {
    emptyAnswer,
    ExamAnswer,
    ExamCardInput,
    ExamSetup,
    missedCardIds,
    pickExamQuestions,
    scoreExam,
} from "src/exam/exam";
import { aiCheckIndexes, aiCheckInput, applyAiChecks, runAiChecks } from "src/exam/exam-ai-check";
import { formatExamFile, parseExamFile } from "src/exam/exam-results-file";

const CARDS: ExamCardInput[] = [
    ["t1", "What does CAE stand for?", "Chief Audit Executive"],
    ["t2", "Who approves the charter?", "The board"],
    ["t3", "What is the first line?", "Management"],
    ["t4", "What is the third line?", "Internal audit"],
    ["t5", "What is the second line?", "Risk and compliance"],
].map(([id, front, back]) => ({
    id,
    deck: "CIA",
    front,
    back,
    isCloze: false,
    suspended: false,
}));

const SETUP: ExamSetup = {
    decks: [],
    count: 10,
    minutes: null,
    filter: "all",
    passPercent: 60,
    title: "Exam · CIA",
    aiCheck: true,
};

/** What the person typed for each card: exact, the same meaning, wrong, gibberish, nothing. */
const TYPED: Record<string, string> = {
    t1: "chief audit executive",
    t2: "the board of directors",
    t3: "the auditors",
    t4: "xyzzy",
    t5: "",
};

/** The fields of the user message a request carries. */
function sentFields(params: RequestUrlParam): Record<string, string> {
    const body = JSON.parse(params.body as string) as { messages: { content: string }[] };
    return JSON.parse(body.messages[1].content) as Record<string, string>;
}

/** What the AI says about each typed answer: the same meaning, a different one, or no reply at all. */
const request = jest.fn<ReturnType<AiRequestFn>, [RequestUrlParam]>(async (params) => {
    const sent = sentFields(params);
    if (sent.typed === "xyzzy") throw new Error("offline");
    const same = sent.typed === "the board of directors";
    const reply = {
        verdict: same ? "equivalent" : "incorrect",
        reason: same ? "Names the same body." : "Management is the first line.",
        checks: {
            essentialFacts: same ? "preserved" : "changed",
            quantitiesAndUnits: "preserved",
            polarityAndConditions: "preserved",
            completeness: "complete",
        },
    };
    return {
        status: 200,
        text: JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }),
    };
});

function examWith(setup: ExamSetup) {
    const questions = pickExamQuestions(CARDS, setup, () => 0);
    const answers: ExamAnswer[] = questions.map((q) => ({
        ...emptyAnswer(),
        typed: TYPED[q.cardId],
    }));
    return scoreExam(setup, questions, answers, 0, 60_000, false);
}

describe("AI checks of typed answers", () => {
    beforeEach(() => request.mockClear());

    test("an answer with the same meaning counts as right; any other verdict, or none, leaves it wrong", async () => {
        const settings = cloneDefaultSettings();
        settings.aiProvider = "openai";
        settings.aiModel = "test-model";
        settings.aiKeySecret = "fs-ai-key";
        const app = { secretStorage: { getSecret: () => " sk-test\n" } } as unknown as App;
        const checker = meaningChecker(app, () => settings, request);
        expect(checker.usable()).toBe(true);

        const exact = examWith(SETUP);
        expect(exact.right).toBe(1);
        // Only typed answers that were given and did not match exactly are sent
        const plan = aiCheckIndexes(exact);
        expect(plan.map((index) => exact.items[index].q.cardId).sort()).toEqual(["t2", "t3", "t4"]);

        const checks = await runAiChecks(
            plan.map((index) => aiCheckInput(exact.items[index])),
            (input) => checker.check(input),
            { signal: new AbortController().signal },
        );
        const marked = applyAiChecks(exact, new Map(plan.map((index, i) => [index, checks[i]])));

        // Each request carries the question, the expected answer and the typed answer, and nothing else
        expect(request).toHaveBeenCalledTimes(3);
        for (const [params] of request.mock.calls) {
            expect(params.headers?.Authorization).toBe("Bearer sk-test");
            expect(Object.keys(sentFields(params)).sort()).toEqual([
                "expected",
                "question",
                "typed",
            ]);
        }

        const item = (id: string) => marked.items.find((found) => found.q.cardId === id);
        expect(item("t1")).toMatchObject({ right: true });
        expect(item("t1")?.ai).toBeUndefined();
        expect(item("t2")).toMatchObject({
            right: true,
            ai: { verdict: "equivalent", reason: "Names the same body." },
        });
        expect(item("t3")).toMatchObject({
            right: false,
            ai: { verdict: "incorrect", reason: "Management is the first line." },
        });
        expect(item("t4")).toMatchObject({
            right: false,
            ai: { verdict: "unavailable", reason: "provider" },
        });
        expect(item("t5")).toMatchObject({ right: null });
        expect(marked).toMatchObject({ right: 2, total: 5, percent: 40, passed: false });
        expect(marked.perDeck).toEqual([{ deck: "CIA", right: 2, total: 5 }]);
        expect(missedCardIds(marked).sort()).toEqual(["t3", "t4", "t5"]);

        // The file shows the verdicts and reasons, and reads back with the AI's marks
        const text = formatExamFile(marked);
        expect(text).toContain("| AI checks | 1 of 3 counted right |");
        expect(text).toMatch(
            /^\| \d\. Who approves the charter\? \| the board of directors \| Same meaning, counted right \| Names the same body\. \|$/m,
        );
        expect(text).toContain("| The provider could not complete the check |");
        expect(parseExamFile(text)).toEqual(marked);
    });

    test("nothing is sent for an exam set up without the option", () => {
        const { aiCheck: _, ...withoutAi } = SETUP;
        expect(aiCheckIndexes(examWith(withoutAi))).toEqual([]);
        expect(aiCheckIndexes(examWith({ ...SETUP, aiCheck: false }))).toEqual([]);
        expect(request).not.toHaveBeenCalled();
    });
});
