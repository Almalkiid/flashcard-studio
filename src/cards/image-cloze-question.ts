/**
 * An image cloze question: card text that holds one `image-cloze` block at the left edge, with or without text
 * clozes. The text's clozes and the block's masks share card numbers, as Anki collects them from every field of a
 * note: card 1 asks text cloze 1 and every mask asked on 1. A block with no text clozes is the same question with no
 * text cards.
 *
 * What is inside a block is never read as text: every image cloze fence in the text (also an indented or quoted one)
 * is swapped for placeholder lines before the text clozes are read, and put back when a card is made, so a hint such
 * as `==9;;x==` is never a cloze. The placeholders keep the text's line count.
 */
import { IClozeFormatter } from "clozecraft";

import {
    CardFrontBack,
    QuestionTypeClozeFormatter,
    QuestionTypeClozeInputFormatter,
} from "src/cards/expand";
import { StudioSettings } from "src/data/settings-model";
import { createClozeNote } from "src/math/math-cloze";
import {
    BlockProblem,
    ImageClozeBlock,
    parseImageClozeBlock,
    scanImageClozeFences,
} from "src/occlusion/image-cloze-block";
import { cardNumbersOf } from "src/occlusion/image-cloze-cards";
import { imageClozeCardMarkdown } from "src/occlusion/image-cloze-view";

/** The private-use characters of the placeholders: U+E100 (open) n U+E101 on a fence's first line, U+E102 on the rest. */
export const IMAGE_CLOZE_PLACEHOLDER_RANGE = { first: 0xe100, last: 0xe1ff };
const OPEN = "";
const CLOSE = "";
const REST = "";
const PLACEHOLDER = new RegExp(`${OPEN}(\\d+)${CLOSE}(?:\\n${REST})*`, "g");

export interface ImageClozeQuestion {
    /** The text with every image cloze fence swapped for placeholder lines. */
    template: string;
    block: ImageClozeBlock;
    /** How many cards the text clozes make (0 for none). */
    textCards: number;
    /** The question's card numbers, ascending. */
    cardNumbers: number[];
}

export type QuestionProblem = BlockProblem | "two-blocks" | "unclosed";

/** A question, or what is wrong with it and on which line of the text (from 0). */
export type QuestionRead =
    | { ok: true; question: ImageClozeQuestion }
    | { ok: false; problem: QuestionProblem; line: number };

/** Whether the text holds an image cloze block at the left edge: a block that makes cards. */
export function hasImageClozeBlock(text: string): boolean {
    return scanImageClozeFences(text.split("\n")).some((span) => span.leftEdge);
}

/**
 * The text with every image cloze fence swapped for placeholder lines, and where each fence was (its first and last
 * line). The fence at the left edge is the one that makes cards (`owning`); the others are drawn as in the note.
 */
export function swapImageClozeFences(text: string): {
    swapped: string;
    fences: { start: number; end: number; owning: boolean }[];
} {
    const lines = text.split("\n");
    const fences = scanImageClozeFences(lines).map((span) => ({
        start: span.open,
        end: span.close,
        owning: span.leftEdge,
    }));
    fences.forEach((fence, n) => {
        lines[fence.start] = `${OPEN}${n}${CLOSE}`;
        for (let at = fence.start + 1; at <= fence.end; at++) lines[at] = REST;
    });
    return { swapped: lines.join("\n"), fences };
}

/** Puts the fences back into a card side: the owning one as `owning(n)` gives it, the others as they were written. */
function restoreFences(
    side: string,
    original: string[],
    fences: { start: number; end: number }[],
    owning: (n: number) => string | null,
): string {
    return side.replace(PLACEHOLDER, (_match, n: string) => {
        const index = Number(n);
        const fence = fences[index];
        if (fence === undefined) return "";
        return owning(index) ?? original.slice(fence.start, fence.end + 1).join("\n");
    });
}

function clozeStyle(settings: StudioSettings): IClozeFormatter {
    return settings.convertClozePatternsToInputs || settings.typeAnswers
        ? new QuestionTypeClozeInputFormatter()
        : new QuestionTypeClozeFormatter();
}

/** Each cloze written as its answer: the text of a card that asks none of them. */
const ALL_ANSWERS: IClozeFormatter = {
    asking: (answer?: string) => answer ?? "",
    showingAnswer: (answer: string) => answer,
    hiding: (answer?: string) => answer ?? "",
};

/**
 * The text with every text cloze shown as its plain answer, as on a card that asks none of them: for a card number
 * above the text's cards. Our own formatter writes each answer (not the math formatter `createClozeNote` hands back,
 * which would keep math answers hidden), then math is restored as on any card.
 */
export function allShownText(template: string, settings: StudioSettings): string {
    const made = createClozeNote(
        template,
        settings.clozePatterns,
        settings.latexClozes === true,
        ALL_ANSWERS,
    );
    if (made.note === null || made.note.numCards === 0) return template;
    return made.render(made.note.getCardFront(0, ALL_ANSWERS));
}

/**
 * Reads the question in a card's text. Null when no image cloze block is at the left edge; a problem for two such
 * blocks, one that is not closed, one with a line that cannot be read, or one that holds a comment.
 */
export function readImageClozeQuestion(
    text: string,
    settings: StudioSettings,
): QuestionRead | null {
    const lines = text.split("\n");
    const spans = scanImageClozeFences(lines);
    const owning = spans.filter((span) => span.leftEdge);
    if (owning.length === 0) return null;
    if (owning.length > 1) return { ok: false, problem: "two-blocks", line: owning[1].open };
    const span = owning[0];
    if (!span.closed) return { ok: false, problem: "unclosed", line: span.open };

    const read = parseImageClozeBlock(lines.slice(span.open + 1, span.close).join("\n"));
    if (read.ok === false)
        return {
            ok: false,
            problem: read.problem,
            line: read.line > 0 ? span.open + read.line : span.open,
        };

    const { swapped } = swapImageClozeFences(text);
    const made = createClozeNote(
        swapped,
        settings.clozePatterns,
        settings.latexClozes === true,
        ALL_ANSWERS,
    );
    const textCards = made.note?.numCards ?? 0;
    return {
        ok: true,
        question: {
            template: swapped,
            block: read.block,
            textCards,
            cardNumbers: cardNumbersOf(textCards, read.block),
        },
    };
}

/**
 * The cards of an image cloze question, one per card number, each with its number. Card k is the text's card k (or,
 * above the text's cards, the text with every cloze shown), with the picture of card k where the block was.
 */
export function expandImageCloze(text: string, settings: StudioSettings): CardFrontBack[] {
    const read = readImageClozeQuestion(text, settings);
    if (read === null || read.ok === false) return [];
    const { template, block, textCards, cardNumbers } = read.question;

    const original = text.split("\n");
    const { fences } = swapImageClozeFences(text);
    const owner = fences.findIndex((fence) => fence.owning);
    const made = createClozeNote(
        template,
        settings.clozePatterns,
        settings.latexClozes === true,
        clozeStyle(settings),
    );
    const shown = cardNumbers.some((k) => k > textCards) ? allShownText(template, settings) : "";

    return cardNumbers.map((k) => {
        const side = (which: "front" | "back"): string => {
            const textSide =
                made.note !== null && k <= textCards
                    ? made.render(
                          which === "front"
                              ? made.note.getCardFront(k - 1, made.formatter)
                              : made.note.getCardBack(k - 1, made.formatter),
                      )
                    : shown || template;
            return restoreFences(textSide, original, fences, (n) =>
                n === owner
                    ? imageClozeCardMarkdown({
                          kind: "cloze",
                          block,
                          card: k,
                          side: which,
                          textCards,
                      })
                    : null,
            );
        };
        const card = new CardFrontBack(side("front"), side("back"));
        card.cardNumber = k;
        return card;
    });
}

/**
 * A cloze whose text holds image cloze fences that make no cards (indented or quoted): its cards as ever, but read
 * with the fences swapped out, so nothing in them is a cloze, and put back as they were written.
 */
export function withFencesKept(
    text: string,
    expand: (swapped: string) => CardFrontBack[],
): CardFrontBack[] {
    const { swapped, fences } = swapImageClozeFences(text);
    if (fences.length === 0) return expand(text);
    const original = text.split("\n");
    return expand(swapped).map((card) => {
        const kept = new CardFrontBack(
            restoreFences(card.front, original, fences, () => null),
            restoreFences(card.back, original, fences, () => null),
        );
        kept.cardNumber = card.cardNumber;
        return kept;
    });
}
