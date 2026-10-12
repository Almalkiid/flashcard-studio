import { parseMultipleChoice } from "src/data/data-structures/card/questions/multiple-choice";
import {
    ExamAnswer,
    ExamQuestion,
    ExamResume,
    ExamSetup,
    ExamStart,
    isAnswered,
    remainingMs,
} from "src/exam/exam";
import { readAnswer, readQuestion, readSetup } from "src/exam/exam-results-file";

/**
 * An exam that has been started and not finished, as it is kept in a file of its own in the plugin's folder so that it
 * can be taken up again after the tab is closed, the app is quit, or the device restarts. It holds everything the screen needs (the questions
 * with the order of their options, the answers, the question that was up) and does not depend on the cards being
 * unchanged. A timed exam keeps its deadline: time passes while the exam is closed, as in a real one.
 */
export interface ExamDraft {
    version: 1;
    /** Names the exam among the saved ones: the time it started. */
    id: string;
    setup: ExamSetup;
    questions: ExamQuestion[];
    answers: ExamAnswer[];
    /** The index of the question that was up. */
    current: number;
    startedMs: number;
    /** When the time runs out, or null without a limit. */
    deadlineMs: number | null;
    /** When this copy was written. */
    savedMs: number;
}

export function newDraftId(startedMs: number): string {
    return String(startedMs);
}

function deadlineOf(setup: ExamSetup, startedMs: number): number | null {
    return setup.minutes === null ? null : startedMs + setup.minutes * 60_000;
}

function copyAnswer(answer: ExamAnswer): ExamAnswer {
    return { ...answer, chosen: [...answer.chosen] };
}

/** The draft of an exam as it stands. The answers are copied: the screen goes on changing its own. */
export function makeDraft(
    state: {
        setup: ExamSetup;
        questions: ExamQuestion[];
        answers: ExamAnswer[];
        current: number;
        startedMs: number;
        /** The name it is kept under; the start's by default. */
        id?: string;
    },
    nowMs: number,
): ExamDraft {
    return {
        version: 1,
        id: state.id ?? newDraftId(state.startedMs),
        setup: state.setup,
        questions: state.questions,
        answers: state.answers.map(copyAnswer),
        current: state.current,
        startedMs: state.startedMs,
        deadlineMs: deadlineOf(state.setup, state.startedMs),
        savedMs: nowMs,
    };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/**
 * A draft as it is kept in its file. A multiple choice question's options are in its `back` already, so `choice` (a
 * second copy of them) is not written; reading works it out again.
 */
export function draftText(draft: ExamDraft): string {
    return JSON.stringify(draft, (key, value: unknown) => (key === "choice" ? undefined : value));
}

/**
 * What a draft says apart from when it was written. Two drafts with the same key have nothing new to save, so an
 * exam that was only looked at is not written again.
 */
export function draftKey(draft: ExamDraft): string {
    return JSON.stringify(draft, (key, value: unknown) =>
        key === "choice" || key === "savedMs" ? undefined : value,
    );
}

/** A question as a draft keeps it: `choice` is worked out from the answer, whatever was stored under that name. */
function readStoredQuestion(item: unknown): ExamQuestion | null {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const value = item as Record<string, unknown>;
    if (value.kind !== "choice") return readQuestion({ ...value, choice: null });
    const choice = typeof value.back === "string" ? parseMultipleChoice(value.back) : null;
    return choice === null ? null : readQuestion({ ...value, choice });
}

/**
 * Reads a saved draft back. Anything that is not a whole draft (another version, no questions, answers that do not
 * match the questions, a position outside them) is null, so a damaged entry is skipped rather than shown. The deadline
 * is worked out again from the setup and the start.
 */
export function readDraft(raw: unknown): ExamDraft | null {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (value.version !== 1 || typeof value.id !== "string") return null;
    const setup = readSetup(value.setup);
    if (setup === null) return null;
    if (!Array.isArray(value.questions) || !Array.isArray(value.answers)) return null;
    if (value.questions.length === 0 || value.answers.length !== value.questions.length) {
        return null;
    }
    const questions: ExamQuestion[] = [];
    for (const item of value.questions as unknown[]) {
        const question = readStoredQuestion(item);
        if (question === null) return null;
        questions.push(question);
    }
    const answers: ExamAnswer[] = [];
    for (const item of value.answers as unknown[]) {
        const answer = readAnswer(item);
        if (answer === null) return null;
        answers.push(answer);
    }
    const { current, startedMs, savedMs } = value;
    if (!Number.isInteger(current) || (current as number) < 0) return null;
    if ((current as number) >= questions.length) return null;
    if (!isFiniteNumber(startedMs) || !isFiniteNumber(savedMs)) return null;
    return {
        version: 1,
        id: value.id,
        setup,
        questions,
        answers,
        current: current as number,
        startedMs,
        deadlineMs: deadlineOf(setup, startedMs),
        savedMs,
    };
}

export interface DraftStatus {
    /** The question that was up, counting from 1. */
    position: number;
    total: number;
    answered: number;
    /** The time left, or null without a limit. */
    leftMs: number | null;
    /** The deadline has passed: taking the exam up again submits it as it was left. */
    timeUp: boolean;
}

/** Where an exam was left, for the offer to resume it. */
export function draftStatus(draft: ExamDraft, nowMs: number): DraftStatus {
    const leftMs = remainingMs(draft.setup, draft.startedMs, nowMs);
    return {
        position: draft.current + 1,
        total: draft.questions.length,
        answered: draft.questions.filter((q, index) => isAnswered(q, draft.answers[index])).length,
        leftMs,
        timeUp: leftMs === 0,
    };
}

/** What the screen needs to go on from a draft. Copies, so that going on does not change the draft. */
export function resumeOf(draft: ExamDraft): ExamResume {
    return {
        id: draft.id,
        answers: draft.answers.map(copyAnswer),
        current: draft.current,
        startedMs: draft.startedMs,
    };
}

/** The exam to take again from a draft: the same questions in the same order, and where it was left. */
export function startFromDraft(draft: ExamDraft): ExamStart {
    return { setup: draft.setup, questions: draft.questions, resume: resumeOf(draft) };
}

/**
 * The unfinished exams among what is stored, newest first. An entry that is not a whole draft is left out, and so is an
 * exam that is on screen in this session (`live`), which is not unfinished, only open.
 */
export function unfinishedDrafts(
    stored: Iterable<unknown>,
    live: ReadonlySet<string>,
): ExamDraft[] {
    const drafts: ExamDraft[] = [];
    for (const raw of stored) {
        const draft = readDraft(raw);
        if (draft !== null && !live.has(draft.id)) drafts.push(draft);
    }
    return drafts.sort((a, b) => b.savedMs - a.savedMs);
}
