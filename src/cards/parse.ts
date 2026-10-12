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
        if (lines[from + 1]?.startsWith("<!--SR:"))
            return [source + "\n" + lines[from + 1], from + 1];
        if (lines[from + 1]?.startsWith(CARD_METADATA_CALLOUT)) {
            let result = source;
            for (let at = from + 1; at < lines.length && lines[at].trim() !== ""; at++) {
                result += "\n" + lines[at];
                if (lines[at].includes("<!--SR:")) return [result, at];
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
    const textOnlyLines: string[] = options.latexClozes ? [] : lines;
    if (options.latexClozes) {
        for (let start = 0; start < lines.length;) {
            let end = start;
            while (end + 1 < lines.length && !endsParagraph(lines[end + 1])) end++;
            textOnlyLines.push(
                ...splitMath(lines.slice(start, end + 1).join("\n")).textOnly.split("\n"),
            );
            start = end + 1;
        }
    }
    const isClozeLine = (at: number) =>
        clozecrafter.isClozeNote(textOnlyLines[at]) ||
        (options.latexClozes === true && containsMathCloze(lines[at]));
    const paragraphFirst = (at: number) => {
        while (at > 0 && !endsParagraph(lines[at - 1])) at--;
        return at;
    };
    const paragraphLast = (at: number) => {
        while (at + 1 < lines.length && !endsParagraph(lines[at + 1])) at++;
        return at;
    };
    const atomicRange = (at: number): [number, number] | null => {
        const end = paragraphLast(at);
        let opener = -1;
        for (let line = paragraphFirst(at); line < at; line++) {
            for (let count = countDisplayMathDelimiters(lines[line]); count > 0; count--)
                opener = opener === -1 ? line : -1;
        }
        const start = opener === -1 ? at : opener;
        for (let count = countDisplayMathDelimiters(lines[at]); count > 0; count--)
            opener = opener === -1 ? at : -1;
        if (opener === -1) return [start, at];
        for (let line = at + 1; line <= end; line++)
            if (countDisplayMathDelimiters(lines[line]) % 2 === 1) return [start, line];
        return null;
    };
    const atomicCardStart = (last: number) => {
        if (countDisplayMathDelimiters(lines[last]) % 2 === 1)
            for (let line = last - 1; line >= 0 && !endsParagraph(lines[line]); line--)
                if (countDisplayMathDelimiters(lines[line]) % 2 === 1) return line;
        return last;
    };
    const mustStayParagraph = (end: number) => {
        const last = paragraphLast(end);
        for (let line = end + 1; line <= last; line++) {
            const trimmed = lines[line].trim();
            if (
                trimmed === options.multilineCardSeparator ||
                trimmed === options.multilineReversedCardSeparator
            )
                return true;
            if (lines[line].startsWith("<!--SR:")) {
                const first = atomicCardStart(line - 1);
                const cardsInAtomic =
                    createClozeNote(
                        lines.slice(first, line).join("\n"),
                        options.clozePatterns,
                        options.latexClozes === true,
                        { asking: () => "", showingAnswer: () => "", hiding: () => "" },
                    ).note?.numCards ?? 0;
                if (
                    !lines.slice(first, line).some((_value, at) => isClozeLine(first + at)) ||
                    cardsInAtomic < parseCommentMeta(lines[line]).length
                )
                    return true;
            }
        }
        return false;
    };

    for (let index = 0; index < lines.length; index++) {
        const current = lines[index];
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
            while (index < lines.length && !lines[index].includes("-->")) index++;
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
                while (end + 1 < lines.length && isBlockquoteLine(lines[end + 1])) end++;
                const block = lines.slice(index, end + 1);
                const followedBySeparator =
                    lines[end + 1]?.trim() === options.multilineCardSeparator ||
                    lines[end + 1]?.trim() === options.multilineReversedCardSeparator;
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
                        block.map((line) => line.trimEnd()).join("\n"),
                    );
                    cards.push(new ParsedQuestionInfo(CardType.Callout, source, index, last));
                    index = last;
                    firstLine = index + 1;
                    continue;
                }
            }
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
        append(current);
        if (cardType === null) {
            const match = inline.find(({ separator }) =>
                separatorOutsideInlineCode(current, separator),
            );
            if (match) cardType = match.type;
        }
        if (cardType === CardType.SingleLineBasic || cardType === CardType.SingleLineReversed) {
            let source: string;
            let last: number;
            [source, last] = pickup(index, current);
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
            while (close < lines.length && !lines[close].startsWith(fence)) {
                cardText += "\n" + lines[close];
                close++;
            }
            cardText += "\n" + fence;
            index = close < lines.length ? close : lines.length - 1;
        } else if (cardType === null && isClozeLine(index) && !regionsOnly()) {
            const atomic = options.atomicClozes && !startMarker ? atomicRange(index) : null;
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
