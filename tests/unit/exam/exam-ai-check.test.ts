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
import {
    AI_CHECK_FAILURES_TO_STOP,
    aiCheckHold,
    aiCheckIndexes,
    aiCheckInput,
    aiCheckText,
    applyAiChecks,
    runAiChecks,
    withoutAiChecks,
} from "src/exam/exam-ai-check";
import { draftText, makeDraft, readDraft } from "src/exam/exam-draft";
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

    test("checks stopped by failures in a row leave the answers not sent skipped; a setup outcome, setup", async () => {
        const inputs = ["a", "b", "c", "d", "e"].map((typed) => ({
            question: "Q",
            expected: "E",
            typed,
        }));
        const slow = jest.fn(async () => ({
            status: "unavailable" as const,
            reason: "timeout" as const,
        }));
        const afterFailures = await runAiChecks(inputs, slow, {
            signal: new AbortController().signal,
            concurrency: 1,
        });
        expect(slow).toHaveBeenCalledTimes(AI_CHECK_FAILURES_TO_STOP);
        expect(afterFailures.map((check) => check.reason)).toEqual([
            "timeout",
            "timeout",
            "timeout",
            "skipped",
            "skipped",
        ]);

        const notSetUp = jest.fn(async () => ({
            status: "unavailable" as const,
            reason: "setup" as const,
        }));
        const afterSetup = await runAiChecks(inputs, notSetUp, {
            signal: new AbortController().signal,
            concurrency: 1,
        });
        expect(notSetUp).toHaveBeenCalledTimes(1);
        expect(afterSetup.map((check) => check.reason)).toEqual(Array(5).fill("setup"));
    });

    test("an exam started with one provider sends nothing once another is set up, and says why", () => {
        const settings = cloneDefaultSettings();
        settings.aiProvider = "openai-compatible";
        settings.aiModel = "llama3";
        settings.aiBaseUrl = "http://localhost:11434/v1";
        const app = { secretStorage: { getSecret: () => "sk-test" } } as unknown as App;
        const checker = meaningChecker(app, () => settings, request);
        // What the setup showed when the exam started, kept with it and with its draft
        const setup: ExamSetup = { ...SETUP, aiProvider: checker.provider() };
        expect(setup.aiProvider).toBe("localhost:11434");
        const questions = pickExamQuestions(CARDS, setup, () => 0);
        const draft = makeDraft(
            { setup, questions, answers: questions.map(emptyAnswer), current: 0, startedMs: 0 },
            0,
        );
        expect(readDraft(JSON.parse(draftText(draft)))?.setup).toEqual(setup);
        expect(aiCheckHold(setup, checker.snapshot())).toBeNull();

        // Another server on the same computer is another provider; so is a provider with a name
        settings.aiBaseUrl = "http://localhost:1234/v1";
        expect(aiCheckHold(setup, checker.snapshot())).toBe("changed");
        settings.aiProvider = "openai";
        settings.aiKeySecret = "fs-ai-key";
        const exact = examWith(setup);
        const plan = aiCheckIndexes(exact);
        const hold = aiCheckHold(exact.setup, checker.snapshot());
        expect(hold).toBe("changed");
        // An exam set up with the option but no provider recorded is not sent anywhere either
        const { aiProvider: _, ...unnamed } = setup;
        expect(aiCheckHold(unnamed, checker.snapshot())).toBe("changed");

        const marked = withoutAiChecks(exact, plan, hold);
        expect(request).not.toHaveBeenCalled();
        // Every typed answer keeps its exact mark, with the reason shown and saved
        expect(marked.items.map((item) => item.right)).toEqual(
            exact.items.map((item) => item.right),
        );
        expect(marked.right).toBe(exact.right);
        for (const index of plan) {
            expect(marked.items[index].ai).toEqual({ verdict: "unavailable", reason: "changed" });
        }
        expect(aiCheckText({ verdict: "unavailable", reason: "changed" }).verdict).toBe(
            "AI check unavailable — Not sent: the AI provider changed after the exam started.",
        );
        const text = formatExamFile(marked);
        expect(text).toContain("| Not sent: the AI provider changed after the exam started |");
        const read = parseExamFile(text);
        expect(read).toEqual(marked);
        expect(read?.setup.aiProvider).toBe("localhost:11434");
    });

    test("every check of a batch goes to the provider and key read when the checks started", async () => {
        const settings = cloneDefaultSettings();
        settings.aiProvider = "openai-compatible";
        settings.aiModel = "llama3";
        settings.aiBaseUrl = "http://localhost:11434/v1";
        settings.aiKeySecret = "fs-ai-key";
        const getSecret = jest.fn(() => "local-key");
        const app = { secretStorage: { getSecret } } as unknown as App;
        const ai = meaningChecker(app, () => settings, request).snapshot();
        expect(getSecret).toHaveBeenCalledTimes(1);

        const inputs = ["chief audit executive", "the board of directors", "the auditors"].map(
            (typed) => ({ question: "Q", expected: "E", typed }),
        );
        const checks = await runAiChecks(
            inputs,
            async (input) => {
                const outcome = await ai.check(input);
                // The settings change while the batch runs: the rest must not follow them
                settings.aiProvider = "openai";
                settings.aiBaseUrl = "";
                settings.aiKeySecret = "other-key";
                return outcome;
            },
            { signal: new AbortController().signal, concurrency: 1 },
        );
        expect(checks.map((check) => check.verdict)).toEqual([
            "incorrect",
            "equivalent",
            "incorrect",
        ]);
        expect(request.mock.calls.map(([params]) => params.url)).toEqual(
            Array(3).fill("http://localhost:11434/v1/chat/completions"),
        );
        for (const [params] of request.mock.calls) {
            expect(params.headers?.Authorization).toBe("Bearer local-key");
        }
        expect(getSecret).toHaveBeenCalledTimes(1);
        expect(ai.provider()).toBe("localhost:11434");
    });

    test("when the checks stop, an answer sent and not answered is told apart from one never sent", async () => {
        const inputs = ["a", "b", "c", "d", "e"].map((typed) => ({
            question: "Q",
            expected: "E",
            typed,
        }));
        type Outcome = Awaited<ReturnType<Parameters<typeof runAiChecks>[1]>>;
        const graded: Outcome = {
            status: "graded",
            grade: {
                verdict: "equivalent",
                reason: "Same.",
                checks: {
                    essentialFacts: "preserved",
                    quantitiesAndUnits: "preserved",
                    polarityAndConditions: "preserved",
                    completeness: "complete",
                },
            },
        };
        const timeout: Outcome = { status: "unavailable", reason: "timeout" };
        const reasons = (checks: { reason: string }[]) => checks.map((check) => check.reason);

        // Show results now: "a" was answered, "b" and "c" are on their way, "d" and "e" were never sent
        const replies = new Map<string, (outcome: Outcome) => void>();
        const pending = jest.fn(
            (input: { typed: string }) =>
                new Promise<Outcome>((resolve) => replies.set(input.typed, resolve)),
        );
        const abort = new AbortController();
        const onProgress = jest.fn();
        const running = runAiChecks(inputs, pending, {
            signal: abort.signal,
            onProgress,
            concurrency: 2,
        });
        replies.get("a")?.(graded);
        await Promise.resolve();
        await Promise.resolve();
        expect(pending).toHaveBeenCalledTimes(3);
        abort.abort();
        const shown = await running;
        expect(reasons(shown)).toEqual(["Same.", "stopped", "stopped", "skipped", "skipped"]);
        // A reply that comes after the stop changes nothing
        replies.get("b")?.(graded);
        await Promise.resolve();
        expect(reasons(shown)).toEqual(["Same.", "stopped", "stopped", "skipped", "skipped"]);
        expect(onProgress.mock.calls).toEqual([[1]]);
        expect(pending).toHaveBeenCalledTimes(3);

        // The overall time limit: both checks on their way are stopped, the last one was never sent
        const never = jest.fn(() => new Promise<Outcome>(() => undefined));
        const afterTime = await runAiChecks(inputs.slice(0, 3), never, {
            signal: new AbortController().signal,
            concurrency: 2,
            totalMs: 20,
        });
        expect(reasons(afterTime)).toEqual(["stopped", "stopped", "skipped"]);

        // Failures in a row: "b" is still on its way when the third failure stops the rest
        const failing = jest.fn((input: { typed: string }) =>
            input.typed === "b" ? new Promise<Outcome>(() => undefined) : Promise.resolve(timeout),
        );
        const afterFailures = await runAiChecks(inputs, failing, {
            signal: new AbortController().signal,
            concurrency: 2,
        });
        expect(reasons(afterFailures)).toEqual([
            "timeout",
            "stopped",
            "timeout",
            "timeout",
            "skipped",
        ]);
        expect(aiCheckText(afterFailures[1]).verdict).toBe(
            "AI check unavailable — No verdict: the checks stopped before the AI answered.",
        );
        expect(aiCheckText(afterFailures[4]).verdict).toBe(
            "AI check unavailable — Not sent: the checks stopped first.",
        );
    });

    test("nothing is sent for an exam set up without the option", () => {
        const { aiCheck: _, ...withoutAi } = SETUP;
        expect(aiCheckIndexes(examWith(withoutAi))).toEqual([]);
        expect(aiCheckIndexes(examWith({ ...SETUP, aiCheck: false }))).toEqual([]);
        expect(request).not.toHaveBeenCalled();
    });
});
