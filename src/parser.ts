import { ClozeCrafter } from "clozecraft";

import { parseCommentMeta } from "src/data/card-meta";
import { SR_METADATA_CALLOUT } from "src/data/constants";
import {
    isBlockquoteLine,
    isCompleteCalloutCard,
    normalizeCalloutTypes,
    parseCalloutHeader,
} from "src/data/data-structures/card/questions/callout-card";
import {
    containsMathCloze,
    countMathClozes,
} from "src/data/data-structures/card/questions/math-cloze";
import { CardType } from "src/data/data-structures/card/questions/question";
import { SRSettings } from "src/data/settings";

export let debugParser = false;

export interface ParserOptions {
    singleLineCardSeparator: string;
    singleLineReversedCardSeparator: string;
    multilineCardSeparator: string;
    multilineReversedCardSeparator: string;
    multilineCardEndMarker: string;
    clozePatterns: string[];

    // M3b: card syntax. All optional and off when missing, so existing callers parse exactly as before.
    /** A line that opens a card region: blank lines inside it belong to the card. Empty means no regions. */
    multilineCardStartMarker?: string;
    /** Callout types that are cards, e.g. ["question"]. Empty or missing means no callout cards. */
    calloutCardTypes?: string[];
    /** A cloze card is only the line holding the cloze, not the whole paragraph. */
    atomicClozes?: boolean;
    /** `\cloze{answer}{hint}` is a cloze form. */
    latexClozes?: boolean;
}

/**
 * Builds the parser options from the user settings, so that every caller parses a note the same way.
 */
export function parserOptionsFromSettings(settings: SRSettings): ParserOptions {
    return {
        singleLineCardSeparator: settings.singleLineCardSeparator,
        singleLineReversedCardSeparator: settings.singleLineReversedCardSeparator,
        multilineCardSeparator: settings.multilineCardSeparator,
        multilineReversedCardSeparator: settings.multilineReversedCardSeparator,
        multilineCardEndMarker: settings.multilineCardEndMarker,
        clozePatterns: settings.clozePatterns,
        multilineCardStartMarker: settings.multilineCardStartMarker,
        calloutCardTypes: settings.calloutCardTypes,
        atomicClozes: settings.atomicClozes,
        latexClozes: settings.latexClozes,
    };
}

export function setDebugParser(value: boolean) {
    debugParser = value;
}

export class ParsedQuestionInfo {
    cardType: CardType;
    text: string;

    // Line numbers start at 0
    firstLineNum: number;
    lastLineNum: number;

    constructor(cardType: CardType, text: string, firstLineNum: number, lastLineNum: number) {
        this.cardType = cardType;
        this.text = text;
        this.firstLineNum = firstLineNum;
        this.lastLineNum = lastLineNum;
    }

    isQuestionLineNum(lineNum: number): boolean {
        return lineNum >= this.firstLineNum && lineNum <= this.lastLineNum;
    }
}

function markerInsideCodeBlock(text: string, marker: string, markerIndex: number): boolean {
    let goingBack = markerIndex - 1,
        goingForward = markerIndex + marker.length;
    let backTicksBefore = 0,
        backTicksAfter = 0;

    while (goingBack >= 0) {
        if (text[goingBack] === "`") backTicksBefore++;
        goingBack--;
    }

    while (goingForward < text.length) {
        if (text[goingForward] === "`") backTicksAfter++;
        goingForward++;
    }

    // If there's an odd number of backticks before and after,
    //  the marker is inside an inline code block
    return backTicksBefore % 2 === 1 && backTicksAfter % 2 === 1;
}

function hasInlineMarker(text: string, marker: string): boolean {
    // No marker provided
    if (marker.length === 0) return false;

    // Check if the marker is in the text
    const markerIdx = text.indexOf(marker);
    if (markerIdx === -1) return false;

    // Check if it's inside an inline code block
    return !markerInsideCodeBlock(text, marker, markerIdx);
}

/**
 * Determines whether a multiline card has no answer, i.e. there is nothing
 * after the separator line. Such cards are ignored, mirroring how a multiline
 * separator with an empty front is ignored.
 */
function hasEmptyAnswer(cardType: CardType, cardText: string, options: ParserOptions): boolean {
    if (cardType !== CardType.MultiLineBasic && cardType !== CardType.MultiLineReversed) {
        return false;
    }
    const separator: string =
        cardType === CardType.MultiLineBasic
            ? options.multilineCardSeparator
            : options.multilineReversedCardSeparator;
    const textLines: string[] = cardText.split("\n");
    const separatorIdx: number = textLines.findIndex((line) => line.trim() === separator);
    return textLines.slice(separatorIdx + 1).every((line) => line.trim().length === 0);
}

/**
 * Whether the last line of a card's text ends with its `<!--SR:...-->` scheduling comment (which may be
 * followed by an Obsidian block identifier).
 */
function endsWithScheduleComment(cardText: string): boolean {
    const lastLine = cardText.slice(cardText.lastIndexOf("\n") + 1);
    return /<!--SR:.+-->(?:\s+\^[a-zA-Z0-9-]+)?\s*$/.test(lastLine);
}

/**
 * The number of `$$` delimiters of display math in a line. An escaped dollar does not count.
 */
function countDisplayMathDelimiters(line: string): number {
    let count = 0;
    for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === "\\") {
            i++; // skip the escaped character
        } else if (line[i] === "$" && line[i + 1] === "$") {
            count++;
            i++;
        }
    }
    return count;
}

/**
 * Returns flashcards found in `text`
 *
 * It is best that the text does not contain frontmatter, see extractFrontmatter for reasoning
 *
 * @param text - The text to extract flashcards from
 * @param ParserOptions - Parser options
 * @returns An array of parsed question information
 */
export function parse(text: string, options: ParserOptions): ParsedQuestionInfo[] {
    if (debugParser) {
        console.debug("Text to parse:\n<<<" + text + ">>>");
    }

    // Sort inline separators by length, longest first
    const inlineSeparators = [
        { separator: options.singleLineCardSeparator, type: CardType.SingleLineBasic },
        { separator: options.singleLineReversedCardSeparator, type: CardType.SingleLineReversed },
    ];
    inlineSeparators.sort((a, b) => b.separator.length - a.separator.length);

    const cards: ParsedQuestionInfo[] = [];
    let cardText = "";
    let cardType: CardType | null = null;
    let firstLineNo = 0,
        lastLineNo: number;

    const clozecrafter = new ClozeCrafter(options.clozePatterns);
    const lines: string[] = text.replaceAll("\r\n", "\n").split("\n");

    // M3b: card syntax
    const startMarker = options.multilineCardStartMarker ?? "";
    const endMarker = options.multilineCardEndMarker ?? "";
    const calloutTypes: string[] = normalizeCalloutTypes(options.calloutCardTypes);
    // True between a start marker and its end marker. The blank lines in there belong to the card
    let inRegion = false;
    // With a start marker, a multiline card or a cloze card exists only inside a region. Outside one, only the
    // cards that end themselves are picked up: inline cards and callouts.
    const regionsOnly = () => startMarker.length > 0 && !inRegion;

    const isClozeLine = (line: string): boolean =>
        clozecrafter.isClozeNote(line) || (options.latexClozes === true && containsMathCloze(line));

    const hasAnyInlineMarker = (line: string): boolean =>
        inlineSeparators.some(({ separator }) => hasInlineMarker(line, separator));

    // Ends the card being built. A multiline card without an answer is dropped
    const finishCard = (lastLine: number) => {
        if (cardType) {
            if (!hasEmptyAnswer(cardType, cardText, options)) {
                cards.push(
                    new ParsedQuestionInfo(cardType, cardText.trimEnd(), firstLineNo, lastLine),
                );
            }
            cardType = null;
        }
        cardText = "";
    };

    // Picks up the scheduling information that follows lines[from]: a `<!--SR:` comment line, or the
    // sr metadata callout up to its comment. Returns the text with it appended, and the last line taken.
    const pickUpSchedule = (from: number, text: string): [string, number] => {
        let last = from;
        if (from + 1 < lines.length && lines[from + 1].startsWith("<!--SR:")) {
            text += "\n" + lines[from + 1];
            last = from + 1;
        } else if (from + 1 < lines.length && lines[from + 1].startsWith(SR_METADATA_CALLOUT)) {
            for (let j = from + 1; j < lines.length; j++) {
                text += "\n" + lines[j];
                last = j;
                if (lines[j].includes("<!--SR:")) {
                    break;
                }
            }
        }
        return [text, last];
    };

    // Whether a line ends a paragraph: a blank line or a marker
    const endsParagraph = (line: string): boolean => {
        const trimmed = line.trim();
        return (
            trimmed.length === 0 ||
            (endMarker.length > 0 && trimmed === endMarker) ||
            (startMarker.length > 0 && trimmed === startMarker)
        );
    };

    // The first and the last line of the paragraph that lines[from] is in
    const paragraphFirstLine = (from: number): number => {
        let start = from;
        while (start > 0 && !endsParagraph(lines[start - 1])) start--;
        return start;
    };
    const paragraphLastLine = (from: number): number => {
        let end = from;
        while (end + 1 < lines.length && !endsParagraph(lines[end + 1])) end++;
        return end;
    };

    // The number of cards that a line's clozes make
    const clozeCardCount = (line: string): number =>
        (clozecrafter.createClozeNote(line)?.numCards ?? 0) +
        (options.latexClozes === true ? countMathClozes(line) : 0);

    // The lines that the card of an atomic cloze on lines[from] is made of: that line, unless it is part of a
    // `$$ ... $$` block. A block of display math is one piece, and is not cut in two. Returns null when such
    // a block is not closed in the paragraph.
    const atomicClozeRange = (from: number): [number, number] | null => {
        const paragraphStart = paragraphFirstLine(from);
        const paragraphEnd = paragraphLastLine(from);

        // The line that opened the display math that is still open where lines[from] starts, if any
        let opener = -1;
        for (let j = paragraphStart; j < from; j++) {
            for (let k = countDisplayMathDelimiters(lines[j]); k > 0; k--) {
                opener = opener === -1 ? j : -1;
            }
        }
        const start = opener === -1 ? from : opener;
        for (let k = countDisplayMathDelimiters(lines[from]); k > 0; k--) {
            opener = opener === -1 ? from : -1;
        }
        if (opener === -1) return [start, from];

        // The display math is still open at the end of the line: it ends at the next line with a `$$`
        for (let j = from + 1; j <= paragraphEnd; j++) {
            if (countDisplayMathDelimiters(lines[j]) % 2 === 1) return [start, j];
        }
        return null;
    };

    // The lines of the atomic card that ends on lines[last]: the block of display math that ends there, or that line
    const atomicCardEndingAt = (last: number): string[] => {
        if (countDisplayMathDelimiters(lines[last]) % 2 === 1) {
            for (let k = last - 1; k >= 0 && !endsParagraph(lines[k]); k--) {
                if (countDisplayMathDelimiters(lines[k]) % 2 === 1) return lines.slice(k, last + 1);
            }
        }
        return [lines[last]];
    };

    // Atomic clozes make the cloze line the card, but a paragraph that is already one card stays one card:
    //  - a multiline separator further down makes the cloze line part of a multiline question, and
    //  - a scheduling comment that is not directly below an atomic card with at least as many cards as the comment
    //    has entries is a comment of the whole paragraph (written before atomic clozes were turned on). Splitting
    //    the paragraph would leave that schedule without a card, and it would be deleted on the next write.
    const mustStayParagraph = (end: number): boolean => {
        const paragraphEnd = paragraphLastLine(end);
        for (let j = end + 1; j <= paragraphEnd; j++) {
            const trimmed = lines[j].trim();
            if (
                trimmed === options.multilineCardSeparator ||
                trimmed === options.multilineReversedCardSeparator
            ) {
                return true;
            }
            if (lines[j].startsWith("<!--SR:")) {
                const cardLines = atomicCardEndingAt(j - 1);
                const entries = parseCommentMeta(lines[j]).length;
                if (
                    !cardLines.some(isClozeLine) ||
                    clozeCardCount(cardLines.join("\n")) < entries
                ) {
                    return true;
                }
            }
        }
        return false;
    };

    // If a callout card starts at lines[start], returns the last line of it (including its scheduling
    // comment), otherwise null. A callout that holds any other card syntax stays what it always was: an
    // inline card, a cloze, or part of a multiline card. That keeps existing notes and their schedules intact.
    const calloutCardLastLine = (start: number): number | null => {
        const header = parseCalloutHeader(lines[start]);
        if (header === null || !calloutTypes.includes(header.type.toLowerCase())) return null;

        let end = start;
        while (end + 1 < lines.length && isBlockquoteLine(lines[end + 1])) end++;
        const block = lines.slice(start, end + 1);
        if (!isCompleteCalloutCard(block)) return null;
        if (block.some((line) => hasAnyInlineMarker(line) || isClozeLine(line))) return null;

        const below = end + 1 < lines.length ? lines[end + 1].trim() : "";
        if (
            below.length > 0 &&
            (below === options.multilineCardSeparator ||
                below === options.multilineReversedCardSeparator)
        ) {
            return null;
        }
        return pickUpSchedule(end, "")[1];
    };

    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i],
            currentTrimmed = lines[i].trim();

        // M3b: card regions. Checked before the HTML comment skip, so a marker may itself be an HTML comment.
        // Adapted from upstream PR #1652 by xiang2x (MIT): the same start and end marker toggles a region.
        if (startMarker) {
            const isStartLine = currentTrimmed === startMarker;
            const isEndLine = !!endMarker && currentTrimmed === endMarker;
            if (isStartLine || isEndLine) {
                if (inRegion) {
                    // A region ends at its end marker, and a start marker ends it too and opens the next
                    finishCard(i - 1);
                    inRegion = isStartLine && !isEndLine;
                } else if (isStartLine) {
                    finishCard(i - 1);
                    inRegion = true;
                }
                firstLineNo = i + 1;
                continue;
            }
        }

        // Skip everything in HTML comments
        if (currentLine.startsWith("<!--") && !currentLine.startsWith("<!--SR:")) {
            // Advance to the line closing the comment (may be the current line itself)
            while (i < lines.length && !lines[i].includes("-->")) i++;
            // If no card is being accumulated, the next card starts after the comment
            if (cardText.length === 0) {
                firstLineNo = i + 1;
            }
            // The for-loop's own i++ then moves past the comment's closing line
            continue;
        }

        // M3b: a blank line inside a card region is part of the card
        if (inRegion && currentTrimmed.length === 0) {
            if (cardText.length > 0) cardText += "\n";
            else firstLineNo = i + 1;
            continue;
        }

        // Have we reached the end of a card?
        const isEmptyLine = currentTrimmed.length === 0;
        const hasMultilineCardEndMarker =
            options.multilineCardEndMarker && currentTrimmed === options.multilineCardEndMarker;
        if (
            // We've probably reached the end of a card
            (isEmptyLine && !options.multilineCardEndMarker) ||
            // Empty line & we're not picking up any card
            (isEmptyLine && cardType === null) ||
            // We've reached the end of a multi line card &
            //  we're using custom end markers
            hasMultilineCardEndMarker ||
            // A card ends at its scheduling comment, even when we're using end markers. Otherwise
            //  turning on an end marker merges scheduled cards that have no marker yet, and only
            //  one of their schedules survives the next write
            (isEmptyLine && cardType !== null && endsWithScheduleComment(cardText))
        ) {
            if (cardType) {
                // Create a new card, unless it's a multiline card with no answer
                if (!hasEmptyAnswer(cardType, cardText, options)) {
                    lastLineNo = i - 1;
                    cards.push(
                        new ParsedQuestionInfo(
                            cardType,
                            cardText.trimEnd(),
                            firstLineNo,
                            lastLineNo,
                        ),
                    );
                }
                cardType = null;
            }

            cardText = "";
            firstLineNo = i + 1;
            continue;
        }

        // M3b: callout cards. Whatever text came before was not a card, or it would have a type by now
        if (calloutTypes.length > 0 && cardType === null && !inRegion) {
            const calloutLast = calloutCardLastLine(i);
            if (calloutLast !== null) {
                const calloutLines = lines.slice(i, calloutLast + 1);
                cards.push(
                    new ParsedQuestionInfo(
                        CardType.Callout,
                        calloutLines.map((line) => line.trimEnd()).join("\n"),
                        i,
                        calloutLast,
                    ),
                );
                i = calloutLast;
                cardText = "";
                firstLineNo = i + 1;
                continue;
            }
        }

        // Update card text
        if (cardText.length > 0) {
            cardText += "\n";
        }
        cardText += currentLine.trimEnd();

        // Pick up inline cards, but only while the card hasn't been given a
        // type yet — otherwise a "::" inside a multiline card's answer would
        // hijack (and discard) the card built up so far
        if (cardType === null) {
            for (const { separator, type } of inlineSeparators) {
                if (hasInlineMarker(currentLine, separator)) {
                    cardType = type;
                    break;
                }
            }
        }

        if (cardType === CardType.SingleLineBasic || cardType === CardType.SingleLineReversed) {
            cardText = currentLine;
            firstLineNo = i;

            // Pick up scheduling information if present
            [cardText, i] = pickUpSchedule(i, cardText);

            lastLineNo = i;
            cards.push(new ParsedQuestionInfo(cardType, cardText, firstLineNo, lastLineNo));

            cardType = null;
            cardText = "";
        } else if (currentTrimmed === options.multilineCardSeparator && !regionsOnly()) {
            // Ignore card if the front of the card is empty
            if (cardText.length > 1) {
                // Pick up multiline basic cards
                cardType = CardType.MultiLineBasic;
            }
        } else if (currentTrimmed === options.multilineReversedCardSeparator && !regionsOnly()) {
            // Ignore card if the front of the card is empty
            if (cardText.length > 1) {
                // Pick up multiline basic cards
                cardType = CardType.MultiLineReversed;
            }
        } else if (currentLine.startsWith("```") || currentLine.startsWith("~~~")) {
            // Pick up codeblocks
            const codeBlockClose = currentLine.match(/`+|~+/)[0];
            while (i + 1 < lines.length && !lines[i + 1].startsWith(codeBlockClose)) {
                i++;
                cardText += "\n" + lines[i];
            }
            cardText += "\n" + codeBlockClose;
            i++;
        } else if (cardType === null && isClozeLine(currentLine)) {
            const atomic = options.atomicClozes && !startMarker ? atomicClozeRange(i) : null;
            if (atomic !== null && !mustStayParagraph(atomic[1])) {
                // M3b: atomic cloze: the line with the cloze (or the block of math it is in) is the whole card
                const [start, end] = atomic;
                let atomicText: string;
                [atomicText, lastLineNo] = pickUpSchedule(
                    end,
                    lines
                        .slice(start, end + 1)
                        .map((line) => line.trimEnd())
                        .join("\n"),
                );
                cards.push(new ParsedQuestionInfo(CardType.Cloze, atomicText, start, lastLineNo));
                i = lastLineNo;
                cardText = "";
                firstLineNo = i + 1;
            } else if (!regionsOnly()) {
                // Pick up cloze cards
                cardType = CardType.Cloze;
            }
        }
    }

    // Do we have a card left in the queue?
    if (cardType && cardText && !hasEmptyAnswer(cardType, cardText, options)) {
        lastLineNo = lines.length - 1;
        cards.push(new ParsedQuestionInfo(cardType, cardText.trimEnd(), firstLineNo, lastLineNo));
    }

    if (debugParser) {
        console.debug("Parsed cards:\n", cards);
    }

    return cards;
}
