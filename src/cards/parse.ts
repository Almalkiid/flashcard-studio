import { ClozeCrafter } from "clozecraft";

import { parseCommentMeta } from "src/data/card-meta";
import { CardType } from "src/data/data-structures/card/question";
import {
    isBlockquoteLine,
    isCompleteCalloutCard,
    normalizeCalloutTypes,
    parseCalloutHeader,
} from "src/data/data-structures/card/questions/callout-card";
import { CARD_METADATA_CALLOUT } from "src/data/formats";
import { StudioSettings } from "src/data/settings-model";
import { containsMathCloze, createClozeNote } from "src/math/math-cloze";
import { splitMath } from "src/math/math-spans";
import { FenceSpan, scanImageClozeFences } from "src/occlusion/image-cloze-block";
import {
    closingFenceLine,
    isOcclusionFenceStart,
    parseOcclusionBlock,
} from "src/occlusion/occlusion-block";

export let debugParser = false;

export function setDebugParser(value: boolean): void {
    debugParser = value;
}

export interface ParserOptions {
    singleLineCardSeparator: string;
    singleLineReversedCardSeparator: string;
    multilineCardSeparator: string;
    multilineReversedCardSeparator: string;
    multilineCardEndMarker: string;
    clozePatterns: string[];
    multilineCardStartMarker?: string;
    calloutCardTypes?: string[];
    atomicClozes?: boolean;
    latexClozes?: boolean;
}

export class ParsedQuestionInfo {
    constructor(
        public cardType: CardType,
        public text: string,
        public firstLineNum: number,
        public lastLineNum: number,
    ) {}

    isQuestionLineNum(lineNum: number): boolean {
        return this.firstLineNum <= lineNum && lineNum <= this.lastLineNum;
    }
}

export function parserOptionsFromSettings(settings: StudioSettings): ParserOptions {
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

function endsWithScheduleComment(text: string): boolean {
    return /<!--SR:.+-->(?:\s+\^[a-zA-Z0-9-]+)?\s*$/.test(text.slice(text.lastIndexOf("\n") + 1));
}

function countDisplayMathDelimiters(line: string): number {
    let count = 0;
    for (let index = 0; index < line.length - 1; index++) {
        if (line[index] === "\\") index++;
        else if (line[index] === "$" && line[index + 1] === "$") {
            count++;
            index++;
        }
    }
    return count;
}

function separatorOutsideInlineCode(line: string, separator: string): boolean {
    if (!separator) return false;
    const at = line.indexOf(separator);
    if (at < 0) return false;
    const before = line.slice(0, at).split("`").length - 1;
    const after = line.slice(at + separator.length).split("`").length - 1;
    return !(before % 2 === 1 && after % 2 === 1);
}

function hasEmptyMultilineAnswer(text: string, separator: string): boolean {
    const lines = text.split("\n");
    const divider = lines.findIndex((line) => line.trim() === separator);
    return divider >= 0 && lines.slice(divider + 1).every((line) => line.trim() === "");
}

/** Parse note text into question-sized source slices. This deliberately preserves legacy syntax quirks. */
export function parse(text: string, options: ParserOptions): ParsedQuestionInfo[] {
    if (debugParser) console.debug("Text to parse:\n<<<" + text + ">>>");

    const lines = text.replace(/\r\n/g, "\n").split("\n");
    // Image cloze blocks first. What is inside one is never read as a card, a cloze or math: every stage that looks
    // for syntax reads `read`, where the content of each block line is one private-use character (its indent and quote
    // markers kept, so quotes and callouts end where they did, and no blank line cuts a paragraph). Card text is
    // always taken from `lines`. A note without a block reads `lines` itself, exactly as before.
    const spans = scanImageClozeFences(lines);
    const spanAt = new Map<number, FenceSpan>(spans.map((span) => [span.open, span]));
    const read = spans.length === 0 ? lines : maskImageClozeLines(lines, spans);
    const cards: ParsedQuestionInfo[] = [];
    const startMarker = options.multilineCardStartMarker ?? "";
    const endMarker = options.multilineCardEndMarker ?? "";
    const calloutTypes = normalizeCalloutTypes(options.calloutCardTypes);
    const inline = [
        { separator: options.singleLineCardSeparator, type: CardType.SingleLineBasic },
        { separator: options.singleLineReversedCardSeparator, type: CardType.SingleLineReversed },
    ].sort((left, right) => right.separator.length - left.separator.length);
    const clozecrafter = new ClozeCrafter(options.clozePatterns);

    let inRegion = false;
    let cardType: CardType | null = null;
    let cardText = "";
    let firstLine = 0;
    const regionsOnly = () => startMarker.length > 0 && !inRegion;
    const append = (line: string) => {
        cardText += (cardText.length > 0 ? "\n" : "") + line.trimEnd();
    };
    const finish = (lastLine: number) => {
        if (
            cardType !== null &&
            !(
                (cardType === CardType.MultiLineBasic &&
                    hasEmptyMultilineAnswer(cardText, options.multilineCardSeparator)) ||
                (cardType === CardType.MultiLineReversed &&
                    hasEmptyMultilineAnswer(cardText, options.multilineReversedCardSeparator))
            )
        ) {
            cards.push(new ParsedQuestionInfo(cardType, cardText.trimEnd(), firstLine, lastLine));
        }
        cardType = null;
        cardText = "";
    };
    const pickup = (from: number, source: string): [string, number] => {
        let last = from;
        if (read[from + 1]?.startsWith("<!--SR:"))
            return [source + "\n" + lines[from + 1], from + 1];
        if (read[from + 1]?.startsWith(CARD_METADATA_CALLOUT)) {
            let result = source;
            for (let at = from + 1; at < lines.length && read[at].trim() !== ""; at++) {
                result += "\n" + lines[at];
                if (read[at].includes("<!--SR:")) return [result, at];
            }
        }
        return [source, last];
    };
    const endsParagraph = (line: string) => {
        const trimmed = line.trim();
        return (
            trimmed.length === 0 ||
            (endMarker.length > 0 && trimmed === endMarker) ||
            (startMarker.length > 0 && trimmed === startMarker)
        );
    };
    const textOnlyLines: string[] = options.latexClozes ? [] : read;
    if (options.latexClozes) {
        for (let start = 0; start < lines.length;) {
            let end = start;
            while (end + 1 < lines.length && !endsParagraph(read[end + 1])) end++;
            textOnlyLines.push(
                ...splitMath(read.slice(start, end + 1).join("\n")).textOnly.split("\n"),
            );
            start = end + 1;
        }
    }
    const isClozeLine = (at: number) =>
        clozecrafter.isClozeNote(textOnlyLines[at]) ||
        (options.latexClozes === true && containsMathCloze(read[at]));
    // What atomic clozes need to know of the paragraph around a line, worked out for every line in one pass the first
    // time it is asked for: reading the paragraph again for each of its cloze lines is quadratic in a long list.
    // `last` is the last line of the line's paragraph, `openBefore` the line of a display math block that is still
    // open above it in its paragraph (-1 for none)
    let paragraphs: { last: number[]; openBefore: number[] } | null = null;
    const paragraphInfo = () => {
        if (paragraphs !== null) return paragraphs;
        const last = new Array<number>(lines.length);
        for (let line = lines.length - 1; line >= 0; line--) {
            last[line] =
                line + 1 < lines.length && !endsParagraph(read[line + 1]) ? last[line + 1] : line;
        }
        const openBefore = new Array<number>(lines.length);
        for (let line = 0; line < lines.length; line++) {
            let opener = -1;
            if (line > 0 && !endsParagraph(read[line - 1])) {
                opener = openBefore[line - 1];
                for (let count = countDisplayMathDelimiters(read[line - 1]); count > 0; count--)
                    opener = opener === -1 ? line - 1 : -1;
            }
            openBefore[line] = opener;
        }
        paragraphs = { last, openBefore };
        return paragraphs;
    };
    const atomicRange = (at: number): [number, number] | null => {
        const { last, openBefore } = paragraphInfo();
        const end = last[at];
        let opener = openBefore[at];
        const start = opener === -1 ? at : opener;
        for (let count = countDisplayMathDelimiters(read[at]); count > 0; count--)
            opener = opener === -1 ? at : -1;
        if (opener === -1) return [start, at];
        for (let line = at + 1; line <= end; line++)
            if (countDisplayMathDelimiters(read[line]) % 2 === 1) return [start, line];
        return null;
    };
    const atomicCardStart = (last: number) => {
        if (countDisplayMathDelimiters(read[last]) % 2 === 1)
            for (let line = last - 1; line >= 0 && !endsParagraph(read[line]); line--)
                if (countDisplayMathDelimiters(read[line]) % 2 === 1) return line;
        return last;
    };
    // Whether a line keeps the paragraph it is in one card: a multi-line separator, or a schedule comment that is not
    // the atomic cloze's above it (no cloze there, or more entries than it has cards). It depends on the line only
    const keepsParagraph = (line: number) => {
        const trimmed = read[line].trim();
        if (
            trimmed === options.multilineCardSeparator ||
            trimmed === options.multilineReversedCardSeparator
        )
            return true;
        // A paragraph with an image cloze block is one question: its text and its masks share card numbers
        if (spanAt.get(line)?.leftEdge === true) return true;
        if (!read[line].startsWith("<!--SR:")) return false;
        const first = atomicCardStart(line - 1);
        const cardsInAtomic =
            createClozeNote(
                read.slice(first, line).join("\n"),
                options.clozePatterns,
                options.latexClozes === true,
                { asking: () => "", showingAnswer: () => "", hiding: () => "" },
            ).note?.numCards ?? 0;
        return (
            !read.slice(first, line).some((_value, at) => isClozeLine(first + at)) ||
            cardsInAtomic < parseCommentMeta(lines[line]).length
        );
    };
    // For a line, the first line from it to the end of its paragraph that keeps the paragraph one card (-1 for none).
    // Every cloze line of a paragraph asks about the lines below it, so each line is looked at once and remembered
    const keeperFrom = new Map<number, number>();
    const mustStayParagraph = (end: number) => {
        const seen: number[] = [];
        let keeper = -1;
        for (let line = end + 1; line < lines.length && !endsParagraph(read[line]); line++) {
            const known = keeperFrom.get(line);
            if (known !== undefined) {
                keeper = known;
                break;
            }
            seen.push(line);
            if (keepsParagraph(line)) {
                keeper = line;
                break;
            }
        }
        for (const line of seen) keeperFrom.set(line, keeper);
        return keeper !== -1;
    };

    for (let index = 0; index < lines.length; index++) {
        const current = read[index];
        const trimmed = current.trim();
        const marker =
            (startMarker.length > 0 && trimmed === startMarker) ||
            (endMarker.length > 0 && trimmed === endMarker);
        if (marker) {
            finish(index - 1);
            const opens = startMarker.length > 0 && trimmed === startMarker;
            inRegion = opens && (startMarker !== endMarker || !inRegion);
            firstLine = index + 1;
            continue;
        }
        if (current.startsWith("<!--") && !current.startsWith("<!--SR:")) {
            const hadText = cardText.length > 0;
            while (index < lines.length && !read[index].includes("-->")) index++;
            if (!hadText) firstLine = index + 1;
            continue;
        }
        if (inRegion && trimmed === "") {
            if (cardText) append("");
            else firstLine = index + 1;
            continue;
        }
        if (
            (trimmed === "" && endMarker.length === 0) ||
            (trimmed === "" && cardType === null) ||
            (endMarker.length > 0 && trimmed === endMarker) ||
            (trimmed === "" && cardType !== null && endsWithScheduleComment(cardText))
        ) {
            finish(index - 1);
            firstLine = index + 1;
            continue;
        }

        if (cardType === null && !inRegion && calloutTypes.length > 0) {
            const header = parseCalloutHeader(current);
            if (header && calloutTypes.includes(header.type.toLowerCase())) {
                let end = index;
                while (end + 1 < lines.length && isBlockquoteLine(read[end + 1])) end++;
                const block = read.slice(index, end + 1);
                const followedBySeparator =
                    read[end + 1]?.trim() === options.multilineCardSeparator ||
                    read[end + 1]?.trim() === options.multilineReversedCardSeparator;
                const hasInline = block.some((line) =>
                    inline.some(({ separator }) => separatorOutsideInlineCode(line, separator)),
                );
                const hasCloze = block.some((_line, at) => isClozeLine(index + at));
                if (
                    isCompleteCalloutCard(block) &&
                    !followedBySeparator &&
                    !hasInline &&
                    !hasCloze
                ) {
                    const [source, last] = pickup(
                        end,
                        lines
                            .slice(index, end + 1)
                            .map((line) => line.trimEnd())
                            .join("\n"),
                    );
                    cards.push(new ParsedQuestionInfo(CardType.Callout, source, index, last));
                    index = last;
                    firstLine = index + 1;
                    continue;
                }
            }
        }

        // An image cloze block: its lines are card text, never read. One at the left edge makes the paragraph an
        // image cloze question (a cloze question when it has text clozes); one that is never closed runs to the end of
        // the note, as Obsidian shows it, and makes no question
        const span = spanAt.get(index);
        if (span !== undefined) {
            if (span.leftEdge && !span.closed) {
                cardType = null;
                cardText = "";
                break;
            }
            for (let at = index; at <= span.close; at++) append(lines[at]);
            if (span.leftEdge && cardType === null && !regionsOnly())
                cardType = CardType.ImageCloze;
            index = span.close;
            continue;
        }

        const fenceClose = isOcclusionFenceStart(current) ? closingFenceLine(lines, index) : -1;
        const occlusionClose =
            fenceClose >= 0 &&
            parseOcclusionBlock(lines.slice(index + 1, fenceClose).join("\n")) !== null
                ? fenceClose
                : -1;
        if (cardType === null && !inRegion && occlusionClose >= 0) {
            const [source, last] = pickup(
                occlusionClose,
                lines
                    .slice(index, occlusionClose + 1)
                    .map((line) => line.trimEnd())
                    .join("\n"),
            );
            cards.push(new ParsedQuestionInfo(CardType.ImageOcclusion, source, index, last));
            index = last;
            firstLine = index + 1;
            continue;
        }

        const hasEarlierLine = cardText.length > 0;
        append(lines[index]);
        if (cardType === null) {
            const match = inline.find(({ separator }) =>
                separatorOutsideInlineCode(current, separator),
            );
            if (match) cardType = match.type;
        }
        if (cardType === CardType.SingleLineBasic || cardType === CardType.SingleLineReversed) {
            let source: string;
            let last: number;
            [source, last] = pickup(index, lines[index]);
            cards.push(new ParsedQuestionInfo(cardType, source, index, last));
            index = last;
            cardType = null;
            cardText = "";
            continue;
        }
        if (trimmed === options.multilineCardSeparator && !regionsOnly() && hasEarlierLine)
            cardType = CardType.MultiLineBasic;
        else if (
            trimmed === options.multilineReversedCardSeparator &&
            !regionsOnly() &&
            hasEarlierLine
        )
            cardType = CardType.MultiLineReversed;
        else if (
            (current.startsWith("```") || current.startsWith("~~~")) &&
            !(isOcclusionFenceStart(current) && fenceClose === -1)
        ) {
            const fence = current.match(/^(`+|~+)/)?.[1] ?? "";
            let close = index + 1;
            while (close < lines.length && !read[close].startsWith(fence)) {
                cardText += "\n" + lines[close];
                close++;
            }
            cardText += "\n" + fence;
            index = close < lines.length ? close : lines.length - 1;
        } else if (
            (cardType === null || cardType === CardType.ImageCloze) &&
            isClozeLine(index) &&
            !regionsOnly()
        ) {
            // A cloze line in a paragraph that already has an image cloze block joins it, unsplit
            const atomic =
                options.atomicClozes && !startMarker && cardType === null
                    ? atomicRange(index)
                    : null;
            if (atomic !== null && !mustStayParagraph(atomic[1])) {
                const [start, end] = atomic;
                const [source, last] = pickup(
                    end,
                    lines
                        .slice(start, end + 1)
                        .map((line) => line.trimEnd())
                        .join("\n"),
                );
                cards.push(new ParsedQuestionInfo(CardType.Cloze, source, start, last));
                index = last;
                cardText = "";
                firstLine = index + 1;
            } else cardType = CardType.Cloze;
        }
    }
    if (cardType !== null && cardText) finish(lines.length - 1);
    if (debugParser) console.debug("Parsed cards:\n", cards);
    return cards;
}

/** The lines with the content of every image cloze block line turned into one private-use character, its lead kept. */
function maskImageClozeLines(lines: string[], spans: FenceSpan[]): string[] {
    const masked = [...lines];
    for (const span of spans)
        for (let at = span.open; at <= span.close; at++) {
            const lead = /^\s*(?:>\s*)*/.exec(lines[at])?.[0] ?? "";
            masked[at] = lead + "\uE1FF";
        }
    return masked;
}
