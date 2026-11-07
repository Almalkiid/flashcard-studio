import type { App, RequestUrlParam } from "obsidian";

import { meaningChecker } from "src/ai/ai-access";
import { AiRequestFn } from "src/ai/ai-provider";
import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import {
    emptyAnswer,
    ExamCardInput,
    ExamResult,
    ExamSetup,
    pickExamQuestions,
    scoreExam,
} from "src/exam/exam";
import { aiCheckIndexes } from "src/exam/exam-ai-check";
import { ExamRunner } from "src/exam/exam-run";
import type FlashcardStudioPlugin from "src/studio-plugin";

// The results screen is not what these tests are about: the result it is given, and the file saved, are
jest.mock("src/exam/exam-results-view", () => ({
    renderExamResults: () => ({
        showSaving: (): void => undefined,
        showSaved: (): void => undefined,
        showSaveFailed: (): void => undefined,
    }),
}));

const LOCAL_URL = "http://localhost:11434/v1";

/** Five typed questions, each answered with something that is not the answer, so each goes to the AI. */
const CARDS: ExamCardInput[] = ["a", "b", "c", "d", "e"].map((id) => ({
    id,
    deck: "Physics",
    front: `Question ${id}?`,
    back: `Answer ${id}`,
    isCloze: false,
    suspended: false,
}));

/** What the AI says about every answer: a different meaning. */
function aiReply(): ReturnType<AiRequestFn> {
    const reply = {
        verdict: "incorrect",
        reason: "Not the answer.",
        checks: {
            essentialFacts: "changed",
            quantitiesAndUnits: "preserved",
            polarityAndConditions: "preserved",
            completeness: "complete",
        },
    };
    return Promise.resolve({
        status: 200,
        text: JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }),
    });
}

const request = jest.fn<ReturnType<AiRequestFn>, [RequestUrlParam]>(aiReply);

/** The settings of a local server, as the exam was started with. */
function localSettings(): StudioSettings {
    const settings = cloneDefaultSettings();
    settings.aiProvider = "openai-compatible";
    settings.aiModel = "llama3";
    settings.aiBaseUrl = LOCAL_URL;
    settings.aiKeySecret = "fs-ai-key";
    return settings;
}

/**
 * An exam with AI checks, started with the local server and taken up again with every question answered, as the plugin
 * runs it: the checker reads `settings` when it is asked. `submit` submits it and resolves with the result saved;
 * `exact` is its marks before any check.
 */
function examOn(settings: StudioSettings): {
    submit: () => Promise<ExamResult>;
    exact: ExamResult;
} {
    const app = { secretStorage: { getSecret: () => "sk-test" } } as unknown as App;
    const ai = meaningChecker(app, () => settings, request);
    const setup: ExamSetup = {
        decks: [],
        count: CARDS.length,
        minutes: null,
        filter: "all",
        passPercent: 60,
        title: "Exam · Physics",
        aiCheck: true,
        aiProvider: ai.identity(),
    };
    expect(setup.aiProvider).toBe(`openai-compatible ${LOCAL_URL}`);
    const questions = pickExamQuestions(CARDS, setup, () => 0);
    const answers = questions.map(() => ({ ...emptyAnswer(), typed: "something else" }));
    const startedMs = Date.now() - 60_000;
    const exact = scoreExam(setup, questions, answers, startedMs, startedMs, false);

    let saved: (result: ExamResult) => void = () => undefined;
    const done = new Promise<ExamResult>((resolve) => {
        saved = resolve;
    });
    const runner = new ExamRunner(create("div"), {
        plugin: { app } as unknown as FlashcardStudioPlugin,
        setup,
        questions,
        ignoreAccents: false,
        save: (result) => {
            saved(result);
            return Promise.resolve("Exams/Exam.md");
        },
        onStudyMissed: () => undefined,
        onClose: () => undefined,
        resume: { id: "exam-1", answers, current: 0, startedMs },
        ai,
    });
    const submit = async () => {
        // Submit, as the dialog's button and the clock do
        (runner as unknown as { finish(timeUp: boolean): void }).finish(false);
        const result = await done;
        runner.destroy();
        return result;
    };
    return { submit, exact };
}

/** An element, made the way jsdom has it: the element helpers Obsidian adds are not there in a unit test. */
function create(tag: string): HTMLElement {
    return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
}

// The element helpers Obsidian adds, as many of them as the exam screens use here
beforeAll(() => {
    function make(parent: HTMLElement, tag: string, options: DomElementInfo = {}): HTMLElement {
        const el = create(tag);
        if (typeof options.cls === "string") el.className = options.cls;
        if (typeof options.text === "string") el.textContent = options.text;
        parent.appendChild(el);
        return el;
    }
    Object.assign(HTMLElement.prototype, {
        createDiv(this: HTMLElement, options?: DomElementInfo): HTMLElement {
            return make(this, "div", options);
        },
        createSpan(this: HTMLElement, options?: DomElementInfo): HTMLElement {
            return make(this, "span", options);
        },
        createEl(this: HTMLElement, tag: string, options?: DomElementInfo): HTMLElement {
            return make(this, tag, options);
        },
        empty(this: HTMLElement): void {
            this.replaceChildren();
        },
        setText(this: HTMLElement, text: string): void {
            this.textContent = text;
        },
        addClass(this: HTMLElement, ...cls: string[]): void {
            this.classList.add(...cls);
        },
        removeClass(this: HTMLElement, ...cls: string[]): void {
            this.classList.remove(...cls);
        },
        setCssProps(this: HTMLElement, props: Record<string, string>): void {
            for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
        },
    });
});

describe("an exam with AI checks, submitted", () => {
    beforeEach(() => request.mockClear());

    test("sends nothing when another provider is set up than the exam started with", async () => {
        const settings = localSettings();
        const { submit, exact } = examOn(settings);
        const plan = aiCheckIndexes(exact);
        expect(plan).toHaveLength(CARDS.length);

        // Another server on the same computer, set up while the exam was open
        settings.aiBaseUrl = "http://localhost:1234/v1";
        const result = await submit();

        expect(request).not.toHaveBeenCalled();
        // Every typed answer keeps its exact mark, and says why it was not checked
        expect(result.items.map((item) => item.right)).toEqual(
            exact.items.map((item) => item.right),
        );
        for (const index of plan) {
            expect(result.items[index].ai).toEqual({ verdict: "unavailable", reason: "changed" });
        }
    });

    test("sends every check to the provider set up at submit, whatever changes while they run", async () => {
        const settings = localSettings();
        const { submit, exact } = examOn(settings);
        request.mockImplementationOnce(() => {
            // The first request is on its way when the settings change to a provider with a name
            settings.aiProvider = "openai";
            settings.aiBaseUrl = "";
            return aiReply();
        });
        const result = await submit();

        expect(request.mock.calls.map(([params]) => params.url)).toEqual(
            Array(CARDS.length).fill(`${LOCAL_URL}/chat/completions`),
        );
        for (const index of aiCheckIndexes(exact)) {
            expect(result.items[index].ai).toEqual({
                verdict: "incorrect",
                reason: "Not the answer.",
            });
        }
    });
});
