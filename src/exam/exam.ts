import {
    isChoiceCorrect,
    MultipleChoice,
    parseMultipleChoice,
    shuffledOrder,
} from "src/data/data-structures/card/questions/multiple-choice";
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
    /** The note the card is in, for the links and images in its text. */
    sourcePath: string;
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

export function emptyAnswer(): ExamAnswer {
    return { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0 };
}

function kindOf(back: string, filter: ExamCardFilter): ExamQuestionKind | null {
    if (parseMultipleChoice(back) !== null) return "choice";
    if (filter === "choice-only") return null;
    return typedAnswerTarget(back) !== null ? "typed" : "self";
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
    const eligible: { card: ExamCardInput; kind: ExamQuestionKind }[] = [];
    for (const card of cards) {
        if (card.suspended || card.isCloze) continue;
        if (!scopes.some((scope) => deckMatches(scope, card.deck))) continue;
        if (seen.has(card.id)) continue;
        const kind = kindOf(card.back, setup.filter);
        if (kind === null) continue;
        seen.add(card.id);
        eligible.push({ card, kind });
    }

    const shuffleOptions = setup.shuffleOptions !== false;
    return shuffledOrder(eligible.length, random)
        .slice(0, Math.max(0, setup.count))
        .map((index) => {
            const { card, kind } = eligible[index];
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
            return compareTypedAnswer(a.typed, typedAnswerTarget(q.back) ?? q.back, ignoreAccents)
                .exact;
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
