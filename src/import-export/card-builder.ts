import { convertAnkiClozes, hasAnkiCloze } from "src/import-export/anki-cloze";
import { NoteKind } from "src/import-export/anki-types";

/** Basic notes are written as `Question::Answer` on one line, or as question, a `?` line and the answer. */
export type BasicStyle = "single" | "multi";

export interface CardSeparators {
    singleLine: string;
    singleLineReversed: string;
    multiLine: string;
    multiLineReversed: string;
}

export const DEFAULT_SEPARATORS: CardSeparators = {
    singleLine: "::",
    singleLineReversed: ":::",
    multiLine: "?",
    multiLineReversed: "??",
};

/** A line with only this reads as a blank line but does not end the card (a blank line would). */
export const BLANK_LINE_IN_CARD = "<br>";

export type CardResult =
    { markdown: string; clozeNeedsCurlyPattern: boolean } | { skipped: "empty" | "invalid-cloze" };

/**
 * How many backticks come before and after `index` on the line decides whether the parser sees the marker at
 * `index` as inline code, exactly like the parser's own check.
 */
function insideInlineCode(line: string, index: number, length: number): boolean {
    const count = (part: string): number => part.split("`").length - 1;
    return count(line.slice(0, index)) % 2 === 1 && count(line.slice(index + length)) % 2 === 1;
}

/**
 * The parser reads a line with the single-line separator as a card of its own, wherever in a card the line is. A
 * separator that is part of the text (`std::vector`) is written with a character reference for its second character,
 * which shows the same and does not match.
 */
function protectSeparator(text: string, separator: string): string {
    if (separator === "") return text;
    // The character reference replaces the second character, or the only one of a one character separator
    const at = Math.min(1, separator.length - 1);
    const protectedSeparator =
        separator.slice(0, at) + `&#${separator.charCodeAt(at)};` + separator.slice(at + 1);
    return text
        .split("\n")
        .map((line) => {
            const first = line.indexOf(separator);
            if (first === -1 || insideInlineCode(line, first, separator.length)) return line;
            return line.split(separator).join(protectedSeparator);
        })
        .join("\n");
}

/** Protects both single-line separators, the basic and the reversed one. */
function protectSeparators(text: string, separators: CardSeparators): string {
    return protectSeparator(
        protectSeparator(text, separators.singleLine),
        separators.singleLineReversed,
    );
}

/** A `#word` at the very start of a card is read as the card's deck. */
function protectLeadingTag(text: string): string {
    return /^\s*#[^\s#]/.test(text) ? text.replace("#", "\\#") : text;
}

/**
 * `front` and `back` on one line with the single-line separator, or null when the parser would not read that line
 * back as the same card. The separator and the text next to it can make another separator: `Capital of France:` and
 * `Paris` with `::` give `Capital of France:::Paris`, which the parser reads as a reversed card cut at `:::`.
 */
function singleLineCard(
    front: string,
    back: string,
    reversed: boolean,
    separators: CardSeparators,
): string | null {
    const separator = reversed ? separators.singleLineReversed : separators.singleLine;
    const other = reversed ? separators.singleLine : separators.singleLineReversed;
    const line = `${front}${separator}${back}`;
    // The parser looks for the longer separator first, for the basic one first when they are as long
    const otherFirst =
        other.length > separator.length || (other.length === separator.length && reversed);
    const readBack =
        separator !== "" &&
        !line.includes("\n") &&
        line.indexOf(separator) === front.length &&
        !insideInlineCode(line, front.length, separator.length) &&
        !(otherFirst && other !== "" && line.includes(other));
    return readBack ? line : null;
}

/**
 * Writes one Anki note as flashcard Markdown.
 *
 * @param kind - The kind of note.
 * @param fields - The note's fields, as Markdown (see `fieldToMarkdown`).
 * @param style - How to write basic notes. A note is written on several lines whatever the style if it does not fit
 * on one line.
 */
export function buildCard(
    kind: NoteKind,
    fields: string[],
    style: BasicStyle,
    separators: CardSeparators = DEFAULT_SEPARATORS,
): CardResult {
    const filled = fields.map((field) => field.trim());

    if (kind === "cloze") {
        if (filled[0] === "" || !hasAnkiCloze(filled[0])) return { skipped: "empty" };
        const converted = convertAnkiClozes(filled[0]);
        if (converted === null) return { skipped: "invalid-cloze" };
        const extra = filled.slice(1).filter((field) => field !== "");
        const text = [protectSeparators(converted, separators), ...extra].join(
            `\n${BLANK_LINE_IN_CARD}\n`,
        );
        return { markdown: text, clozeNeedsCurlyPattern: true };
    }

    const front = filled[0] ?? "";
    const back =
        kind === "other"
            ? filled
                  .slice(1)
                  .filter((field) => field !== "")
                  .join(`\n${BLANK_LINE_IN_CARD}\n`)
            : (filled[1] ?? "");
    if (front === "" || back === "") return { skipped: "empty" };

    const reversed = kind === "reversed";
    const oneLine =
        style === "single" &&
        !front.includes(separators.singleLine) &&
        !back.includes(separators.singleLine)
            ? singleLineCard(protectLeadingTag(front), back, reversed, separators)
            : null;
    if (oneLine !== null) return { markdown: oneLine, clozeNeedsCurlyPattern: false };

    const separator = reversed ? separators.multiLineReversed : separators.multiLine;
    const safeFront = protectLeadingTag(protectSeparators(front, separators));
    return { markdown: `${safeFront}\n${separator}\n${back}`, clozeNeedsCurlyPattern: false };
}
