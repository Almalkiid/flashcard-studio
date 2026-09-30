import {
    isChoiceCorrect,
    MultipleChoice,
    parseMultipleChoice,
    shuffledOrder,
} from "src/data/data-structures/card/questions/multiple-choice";
import { occlusionTypedTarget } from "src/occlusion/occlusion-view";
import { digitFromKeyCode } from "src/scheduling/answer-keys";
import { compareTypedAnswer, typedAnswerTarget } from "src/scheduling/typed-answer";
import { deckMatches } from "src/stats/scope";

/**
 * Exams: building one from the cards, marking it, and what an exam remembers. No screens and no vault here; the
 * screens are in exam-run.ts and the files in exam-results-file.ts.
 *
 * An exam never touches a card's schedule: it only reads the cards.
 */

/** Which cards an exam asks: multiple choice cards only, or every basic card. */
export type ExamCardFilter = "choice-only" | "all";

export interface ExamSetup {
    /** Deck paths such as `CIA/Part1`; each covers its subdecks. Empty for every deck. */
    decks: string[];
    count: number;
    /** The time limit in minutes; null for no limit. */
    minutes: number | null;
    filter: ExamCardFilter;
    /** The score, in percent, from which the exam counts as passed. */
    passPercent: number;
    title: string;
    /** Show each multiple choice question's options in a random order. Absent means yes. */
    shuffleOptions?: boolean;
}

export const EXAM_PRESETS: { id: "quick" | "cia"; count: number; minutes: number | null }[] = [
    { id: "quick", count: 20, minutes: null },
    { id: "cia", count: 125, minutes: 150 },
];

/**
 * How a question is answered: by choosing options, by typing a short answer, or by looking at the answer and saying
 * whether it was known.
 */
export type ExamQuestionKind = "choice" | "typed" | "self";

export interface ExamQuestion {
    cardId: string;
    /** The deck the card was picked from, as a path. */
    deck: string;
    kind: ExamQuestionKind;
    front: string;
    back: string;
    choice: MultipleChoice | null;
    /** Display position to option index for a choice question; empty for the other kinds. */
    order: number[];
    /** The note the card is in, for the links and images in its text. Absent means none. */
    sourcePath?: string;
    /**
     * For a typed question: the plain text to type, worked out once when the question is picked (the label of the mask
     * for an occlusion card, the answer without its Markdown for another). Null for the other kinds.
     */
    typedTarget?: string | null;
}

export interface ExamAnswer {
    /** Option indices (in `choice.options`, not display positions) the person chose. */
    chosen: number[];
    typed: string;
    /** For a self-marked question: whether the person said they knew it; null until they say. */
    selfRight: boolean | null;
    flagged: boolean;
    /** The time spent on the question, in milliseconds. */
    ms: number;
}

/** What an exam needs to know about a card. A card in several decks comes once for each deck. */
export interface ExamCardInput {
    id: string;
    deck: string;
    front: string;
    back: string;
    isCloze: boolean;
    suspended: boolean;
    sourcePath?: string;
}

/** Where an exam that was left goes on: the answers so far, the question that was up, and when it started. */
export interface ExamResume {
    /** The id the saved progress is kept under. */
    id: string;
    answers: ExamAnswer[];
    current: number;
    startedMs: number;
}

/** An exam ready to be taken: how it was set up, and the questions picked for it. */
export interface ExamStart {
    setup: ExamSetup;
    questions: ExamQuestion[];
    /** Set when an exam that was left is taken up again; its clock is the one it started with. */
    resume?: ExamResume;
}

export function emptyAnswer(): ExamAnswer {
    return { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0 };
}

/**
 * The plain text to type for a card's answer: the label of the mask for an occlusion card, the answer without its
 * Markdown for a basic card. Null when there is nothing short and plain to type.
 */
export function examTypedTarget(back: string): string | null {
    return occlusionTypedTarget(back) ?? typedAnswerTarget(back);
}

function kindOf(
    back: string,
    filter: ExamCardFilter,
): { kind: ExamQuestionKind; target: string | null } | null {
    if (parseMultipleChoice(back) !== null) return { kind: "choice", target: null };
    if (filter === "choice-only") return null;
    const target = examTypedTarget(back);
    return target !== null ? { kind: "typed", target } : { kind: "self", target: null };
}

/**
 * The questions of an exam: suspended cards and cloze cards are left out, and so are the cards outside the chosen
 * decks. With `choice-only` only multiple choice cards are asked; with `all` the others are typed when their answer
 * is short plain text and self-marked otherwise. The cards are shuffled and the first `count` taken (fewer when there
 * are not that many). A card that sits in several chosen decks is asked once, under the first.
 */
export function pickExamQuestions(
    cards: ExamCardInput[],
    setup: ExamSetup,
    random: () => number,
): ExamQuestion[] {
    const scopes = setup.decks.length === 0 ? [""] : setup.decks;
    const seen = new Set<string>();
    const eligible: { card: ExamCardInput; kind: ExamQuestionKind; target: string | null }[] = [];
    for (const card of cards) {
        if (card.suspended || card.isCloze) continue;
        if (!scopes.some((scope) => deckMatches(scope, card.deck))) continue;
        if (seen.has(card.id)) continue;
        const found = kindOf(card.back, setup.filter);
        if (found === null) continue;
        seen.add(card.id);
        eligible.push({ card, kind: found.kind, target: found.target });
    }

    const shuffleOptions = setup.shuffleOptions !== false;
    return shuffledOrder(eligible.length, random)
        .slice(0, Math.max(0, setup.count))
        .map((index) => {
            const { card, kind, target } = eligible[index];
            const choice = kind === "choice" ? parseMultipleChoice(card.back) : null;
            const optionCount = choice?.options.length ?? 0;
            return {
                cardId: card.id,
                deck: card.deck,
                kind,
                front: card.front,
                back: card.back,
                choice,
                order: shuffleOptions
                    ? shuffledOrder(optionCount, random)
                    : Array.from({ length: optionCount }, (_, i) => i),
                sourcePath: card.sourcePath ?? "",
                typedTarget: target,
            };
        });
}

/** Whether the question has an answer: an option chosen, text typed, or a self mark. */
export function isAnswered(q: ExamQuestion, a: ExamAnswer): boolean {
    switch (q.kind) {
        case "choice":
            return a.chosen.length > 0;
        case "typed":
            return a.typed.trim() !== "";
        case "self":
            return a.selfRight !== null;
    }
}

/**
 * Whether the answer is right, or null when there is none (which the score counts as wrong). A choice question is
 * right when exactly the right options were chosen; a typed one when the text matches the way typed answers match in a
 * review; a self-marked one when the person said they knew it.
 */
export function isRight(q: ExamQuestion, a: ExamAnswer, ignoreAccents: boolean): boolean | null {
    if (!isAnswered(q, a)) return null;
    switch (q.kind) {
        case "choice":
            return q.choice !== null && isChoiceCorrect(q.choice, a.chosen);
        case "typed":
            return (
                q.typedTarget !== undefined &&
                q.typedTarget !== null &&
                compareTypedAnswer(a.typed, q.typedTarget, ignoreAccents).exact
            );
        case "self":
            return a.selfRight === true;
    }
}

export interface ExamItem {
    q: ExamQuestion;
    a: ExamAnswer;
    /** True or false, or null for a question left unanswered. */
    right: boolean | null;
}

export interface ExamResult {
    setup: ExamSetup;
    startedMs: number;
    endedMs: number;
    right: number;
    total: number;
    percent: number;
    passed: boolean;
    perDeck: { deck: string; right: number; total: number }[];
    items: ExamItem[];
}

/**
 * The score of marked questions. Unanswered questions count as wrong; the percentage is a whole number and the exam is
 * passed at the pass mark or above.
 */
export function summarizeExam(
    setup: ExamSetup,
    items: ExamItem[],
    startedMs: number,
    endedMs: number,
): ExamResult {
    const right = items.filter((item) => item.right === true).length;
    const total = items.length;
    const percent = total === 0 ? 0 : Math.round((right / total) * 100);

    const decks = new Map<string, { deck: string; right: number; total: number }>();
    for (const item of items) {
        let row = decks.get(item.q.deck);
        if (row === undefined) {
            row = { deck: item.q.deck, right: 0, total: 0 };
            decks.set(item.q.deck, row);
        }
        row.total++;
        if (item.right === true) row.right++;
    }

    return {
        setup,
        startedMs,
        endedMs,
        right,
        total,
        percent,
        passed: total > 0 && percent >= setup.passPercent,
        perDeck: [...decks.values()],
        items,
    };
}

/**
 * Marks an exam. A question without an answer record counts as unanswered.
 */
export function scoreExam(
    setup: ExamSetup,
    questions: ExamQuestion[],
    answers: ExamAnswer[],
    startedMs: number,
    endedMs: number,
    ignoreAccents: boolean,
): ExamResult {
    const items = questions.map((q, index) => {
        const a = answers[index] ?? emptyAnswer();
        return { q, a, right: isRight(q, a, ignoreAccents) };
    });
    return summarizeExam(setup, items, startedMs, endedMs);
}

/** The cards not answered right (an unanswered question is one), once each, in the order they were asked. */
export function missedCardIds(result: ExamResult): string[] {
    const ids: string[] = [];
    for (const item of result.items) {
        if (item.right !== true && !ids.includes(item.q.cardId)) ids.push(item.q.cardId);
    }
    return ids;
}

/** `4:59` or `2:30:00`. Never negative. */
export function formatClock(ms: number): string {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    if (hours === 0) return `${minutes}:${seconds}`;
    return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
}

/** The time left of the limit, or null when there is none. Zero once the time is up. */
export function remainingMs(setup: ExamSetup, startedMs: number, nowMs: number): number | null {
    if (setup.minutes === null) return null;
    return Math.max(0, setup.minutes * 60_000 - (nowMs - startedMs));
}

const NAMES_SHOWN = 3;

/** `CIA, Arabic`, or `A, B, C +2` when there are more than three, for a title. */
export function joinDeckNames(names: string[]): string {
    const shown = names.slice(0, NAMES_SHOWN).join(", ");
    return names.length > NAMES_SHOWN ? `${shown} +${names.length - NAMES_SHOWN}` : shown;
}

/**
 * The words of a Markdown text on one line, for a list where the text is only a label: images are left out, links and
 * emphasis keep their words, and a long text is cut on a word with an ellipsis. Empty when the text is only images.
 */
export function plainExcerpt(markdown: string, max = 140): string {
    const text = markdown
        // A fenced block (code, or an occlusion card's data) is not words
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
        .replace(/\[\[([^\]]*)\]\]/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "")
        .replace(/\*\*|__|~~|==|`|\$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const space = cut.lastIndexOf(" ");
    return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The text of a countdown: the time left, rounded up to whole seconds, so 150 minutes read 2:30:00. */
export function formatCountdown(ms: number): string {
    return formatClock(Math.ceil(Math.max(0, ms) / 1000) * 1000);
}

/** When an exam ended: now, but never later than its deadline (a laptop that slept past the limit). */
export function examEndMs(setup: ExamSetup, startedMs: number, nowMs: number): number {
    if (setup.minutes === null) return nowMs;
    return Math.min(nowMs, startedMs + setup.minutes * 60_000);
}

/** What the home's Last exam card shows about an exam. */
export function examSummary(result: ExamResult): {
    title: string;
    percent: number;
    right: number;
    total: number;
    minutes: number;
    endedMs: number;
    passed: boolean;
} {
    return {
        title: result.setup.title,
        percent: result.percent,
        right: result.right,
        total: result.total,
        minutes: Math.max(0, (result.endedMs - result.startedMs) / 60_000),
        endedMs: result.endedMs,
        passed: result.passed,
    };
}

export type ExamKeyAction =
    | { kind: "next" }
    | { kind: "previous" }
    | { kind: "enter" }
    | { kind: "flag" }
    | { kind: "choose"; position: number };

/**
 * What a key press does in an exam. The keys are read by their place on the keyboard (`code`), not by the character
 * they give, so F works on an Arabic layout, and the number row works on AZERTY, where it gives symbols. A press with
 * Ctrl, Cmd or Alt is a shortcut of the application's, not the exam's.
 */
export function examKeyAction(event: {
    key: string;
    code: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
}): ExamKeyAction | null {
    if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return null;
    switch (event.code) {
        case "ArrowRight":
            return { kind: "next" };
        case "ArrowLeft":
            return { kind: "previous" };
        case "Enter":
        case "NumpadEnter":
            return { kind: "enter" };
        case "KeyF":
            return { kind: "flag" };
    }
    const digit = digitFromKeyCode(event.code);
    return digit !== null && digit >= 1 ? { kind: "choose", position: digit - 1 } : null;
}
