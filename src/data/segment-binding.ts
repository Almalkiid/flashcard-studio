/**
 * Which segment of a question's schedule comment belongs to which card, for questions whose schedules are bound to
 * card numbers: those with an image cloze block, and clozes whose comment already carries card numbers. Each segment
 * of such a comment ends with `c=<k>`, so a card keeps its schedule when cards before it come or go, as Anki keeps a
 * card by its number. Every other question binds by position, as it always has, and never comes here.
 *
 * Positions are raw: the place of a segment between the comment's `!`, empty pieces counted, as the editors that change
 * one card's segment in place count them (`card-meta.ts`, `postpone.ts`). One function, `bindQuestion`, gives them, for
 * loading and for editing alike, from the text at hand, so a card is always edited where it was loaded from.
 */
import {
    hasImageClozeBlock,
    readImageClozeQuestion,
    swapImageClozeFences,
} from "src/cards/image-cloze-question";
import type { Card } from "src/data/data-structures/card/flashcard";
import { CardType, Question } from "src/data/data-structures/card/question";
import { StudioSettings } from "src/data/settings-model";
import { createClozeNote, legacyClozeCardIndices } from "src/math/math-cloze";

export type CommentBinding =
    | { kind: "none" }
    | { kind: "unreadable" }
    | { kind: "unnumbered"; nonEmptyRaw: number[] }
    | { kind: "numbered"; rawOf: Map<number, number> };

const COMMENT = /<!--SR:(.+?)-->/;
const CARD_TOKEN = /^c=/;
const VALID_CARD_TOKEN = /^c=([1-9]\d*)$/;

/** The pieces of the first schedule comment, each with its raw position; null when there is no comment. */
function rawPieces(questionText: string): { piece: string; raw: number }[] | null {
    const body = COMMENT.exec(questionText)?.[1];
    if (body === undefined) return null;
    // The comment starts with "!", so the segment of card n is the piece at n + 1
    const lead = body.startsWith("!") ? 1 : 0;
    return body
        .split("!")
        .map((piece, at) => ({ piece: piece.trim(), raw: at - lead }))
        .filter(({ raw }) => raw >= 0);
}

/** Whether the first comment holds any `c=` token, valid or not. */
function hasCardToken(questionText: string): boolean {
    return (rawPieces(questionText) ?? []).some(({ piece }) =>
        piece.split(",").some((token) => CARD_TOKEN.test(token.trim())),
    );
}

/**
 * How the first schedule comment binds. Numbered: every segment holds exactly one valid `c=`, the numbers differ, and
 * no segment is empty; anything else with a `c=` in it is unreadable, and a question with an unreadable comment is not
 * a card, so nothing is rewritten over it. Unnumbered: the raw positions of the segments that are not empty.
 */
export function readBinding(questionText: string): CommentBinding {
    const pieces = rawPieces(questionText);
    if (pieces === null) return { kind: "none" };
    if (!hasCardToken(questionText))
        return {
            kind: "unnumbered",
            nonEmptyRaw: pieces.filter(({ piece }) => piece.length > 0).map(({ raw }) => raw),
        };

    const rawOf = new Map<number, number>();
    for (const { piece, raw } of pieces) {
        const tokens = piece
            .split(",")
            .map((token) => token.trim())
            .filter((token) => CARD_TOKEN.test(token));
        const match = tokens.length === 1 ? VALID_CARD_TOKEN.exec(tokens[0]) : null;
        if (piece.length === 0 || match === null) return { kind: "unreadable" };
        const k = Number(match[1]);
        if (rawOf.has(k)) return { kind: "unreadable" };
        rawOf.set(k, raw);
    }
    return { kind: "numbered", rawOf };
}

/** Whether a question's schedules are bound to card numbers: a cloze or image cloze with a block or a `c=` token. */
export function inBindingScope(questionText: string, type: CardType): boolean {
    if (type !== CardType.Cloze && type !== CardType.ImageCloze) return false;
    return hasImageClozeBlock(questionText) || hasCardToken(questionText);
}

/**
 * For each card, by its number, the raw position of its segment in the first comment of `questionText`, or null when it
 * has none. Numbered: the segment with its number. Unnumbered (written before the question had a block): the text's
 * cards bind by position, through `legacy` when the old math reading applies; a card above the text's cards has none.
 */
export function bindSegments(
    questionText: string,
    cardNumbers: number[],
    textCards: number,
    legacy: number[] | null,
): (number | null)[] {
    const binding = readBinding(questionText);
    if (binding.kind === "numbered") return cardNumbers.map((k) => binding.rawOf.get(k) ?? null);
    if (binding.kind !== "unnumbered") return cardNumbers.map((): number | null => null);
    return cardNumbers.map((k) => {
        if (k > textCards) return null;
        const index = legacy === null ? k - 1 : (legacy[k - 1] ?? -1);
        return index < 0 ? null : (binding.nonEmptyRaw[index] ?? null);
    });
}

/**
 * The one entry point for loading and for editing a question's schedules by card number. `commentText` is the text
 * whose first comment is read (the question as written, or the text about to be changed); `questionText` is the
 * question without its comment, which the cards are made from. Null when the question binds by position (every other
 * question); "unreadable" when it is not a card.
 */
export function bindQuestion(
    commentText: string,
    questionText: string,
    type: CardType,
    settings: StudioSettings,
): { cardNumbers: number[]; positions: (number | null)[] } | "unreadable" | null {
    if (!inBindingScope(commentText, type)) return null;
    const binding = readBinding(commentText);
    if (binding.kind === "unreadable") return "unreadable";

    const read = readImageClozeQuestion(questionText, settings);
    if (read !== null && read.ok === false) return "unreadable";
    const swapped = swapImageClozeFences(questionText).swapped;
    let textCards: number;
    let cardNumbers: number[];
    if (read !== null && read.ok === true) {
        textCards = read.question.textCards;
        cardNumbers = read.question.cardNumbers;
    } else {
        // A cloze with card numbers in its comment and no block (it had one): its text's cards, as numbers 1 to T
        const made = createClozeNote(
            swapped,
            settings.clozePatterns,
            settings.latexClozes === true,
            {
                asking: () => "",
                showingAnswer: () => "",
                hiding: () => "",
            },
        );
        textCards = made.note?.numCards ?? 0;
        cardNumbers = Array.from({ length: textCards }, (_unused, at) => at + 1);
    }

    // The old math reading, as loading does it for any cloze, but against the text's own cards
    const legacy =
        binding.kind === "unnumbered" &&
        settings.latexClozes === true &&
        binding.nonEmptyRaw.length > textCards
            ? legacyClozeCardIndices(swapped, settings.clozePatterns)
            : null;
    return { cardNumbers, positions: bindSegments(commentText, cardNumbers, textCards, legacy) };
}

/**
 * The segments of the first comment whose card number no card uses, as written, by number. A write keeps them after the
 * cards' own, so a card whose number is used again gets its history back, as Anki keeps a card until "Empty Cards".
 * None unless the comment is numbered.
 */
export function keptSegments(commentText: string, used: Iterable<number>): KeptSegment[] {
    const binding = readBinding(commentText);
    if (binding.kind !== "numbered") return [];
    const inUse = new Set(used);
    // The numbers are the ones the binding read, so whatever it accepts (spaces around `c=`) is kept and listed alike
    return [...binding.rawOf]
        .filter(([k]) => !inUse.has(k))
        .sort(([a], [b]) => a - b)
        .map(([number, raw]) => ({ number, segment: segmentAt(commentText, raw) ?? "" }))
        .filter(({ segment }) => segment.length > 0);
}

/** A segment kept for a card number no card uses any more, as written. */
export interface KeptSegment {
    number: number;
    segment: string;
}

/** The text of the segment at a raw position of the first comment, or null. */
export function segmentAt(commentText: string, raw: number): string | null {
    return rawPieces(commentText)?.find((piece) => piece.raw === raw)?.piece ?? null;
}

/**
 * The raw segment positions to change in `text` for some cards of one question, read from that text at the moment of
 * the change: by card number for a question in scope (a card with no segment is left out), by place for every other
 * question, as always. "unreadable" when the question's comment cannot be read: then nothing is changed.
 */
export function positionsForEdit(
    text: string,
    question: Pick<Question, "questionText" | "questionType">,
    cards: Pick<Card, "cardIdx">[],
    settings: StudioSettings,
): Set<number> | "unreadable" {
    const bound = bindQuestion(
        text,
        question.questionText.actualQuestion,
        question.questionType,
        settings,
    );
    if (bound === null) return new Set(cards.map((card) => card.cardIdx));
    if (bound === "unreadable") return "unreadable";
    const positions = new Set<number>();
    for (const card of cards) {
        const raw = bound.positions[card.cardIdx] ?? null;
        if (raw !== null) positions.add(raw);
    }
    return positions;
}
