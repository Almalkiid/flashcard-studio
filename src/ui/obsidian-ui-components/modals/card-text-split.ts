import { CardFrontBackUtil } from "src/cards/expand";
import { parse, parserOptionsFromSettings } from "src/cards/parse";
import { CardType } from "src/data/data-structures/card/question";
import { CARD_METADATA_CALLOUT } from "src/data/formats";
import { StudioSettings } from "src/data/settings-model";
import { findLineIndexOfSearchStringIgnoringWs } from "src/utils/text";

/** The two sides of a card with a separator, as the edit dialog shows them in two fields. */
export interface CardSides {
    front: string;
    back: string;
    /**
     * What stands between the sides of a multi-line card in the note: the separator line with its own padding, and the
     * blank lines around it. The plain separator when not given.
     */
    between?: string;
}

function separatorOf(type: CardType, settings: StudioSettings): string | null {
    switch (type) {
        case CardType.SingleLineBasic:
            return settings.singleLineCardSeparator;
        case CardType.SingleLineReversed:
            return settings.singleLineReversedCardSeparator;
        case CardType.MultiLineBasic:
            return settings.multilineCardSeparator;
        case CardType.MultiLineReversed:
            return settings.multilineReversedCardSeparator;
        default:
            return null;
    }
}

function isMultiLine(type: CardType): boolean {
    return type === CardType.MultiLineBasic || type === CardType.MultiLineReversed;
}

const isBlank = (line: string): boolean => line.trim() === "";

/**
 * Cuts a question into its sides exactly where the note parser does: a single-line card at the first separator, a
 * multi-line card at the first line that is the separator (whatever its padding). The blank lines around the separator
 * of a multi-line card are left out of its sides and kept in `between` with the separator line. The sides keep the
 * indentation of their lines, which is markdown (a code block, a nested list).
 *
 * @returns null when the question has no separator to cut at (a cloze, callout or occlusion card, or a text that lost
 * its separator): it is then edited as one text.
 */
export function splitCardText(
    type: CardType,
    text: string,
    settings: StudioSettings,
): CardSides | null {
    const separator = separatorOf(type, settings);
    if (separator === null) return null;
    if (!isMultiLine(type)) {
        if (!text.includes(separator)) return null;
        const [sides] = CardFrontBackUtil.expand(type, text, settings);
        return { front: sides.front, back: sides.back };
    }

    const lines = text.split("\n");
    const cut = findLineIndexOfSearchStringIgnoringWs(lines, separator);
    if (cut < 0) return null;
    let first = cut;
    while (first > 0 && isBlank(lines[first - 1])) first--;
    let end = cut + 1;
    while (end < lines.length && isBlank(lines[end])) end++;
    return {
        front: lines.slice(0, first).join("\n"),
        back: lines.slice(end).join("\n"),
        between: lines.slice(first, end).join("\n"),
    };
}

/** Puts the sides back together: the text `splitCardText` cut them from, when they were not changed. */
export function joinCardText(type: CardType, sides: CardSides, settings: StudioSettings): string {
    const separator = separatorOf(type, settings);
    if (separator === null) return sides.front;
    if (!isMultiLine(type)) return sides.front + separator + sides.back;
    const lead = sides.front === "" || sides.front.endsWith("\n") ? "" : "\n";
    const trail = sides.back === "" || sides.back.startsWith("\n") ? "" : "\n";
    return sides.front + lead + (sides.between ?? separator) + trail + sides.back;
}

/** Stands for the schedule of one card in the comment that is written after a question that was answered. */
const SCHEDULE_STAND_IN = "!2000-01-01,1,250";

/**
 * The lines of `text` with the schedule comment where `Question.formatForNote` writes it: after the metadata callout the
 * card already has, in a new metadata callout when the settings say so, on the card's last line when the settings say so
 * and nothing that ends the card is there, and otherwise on the line after it.
 */
function withScheduleComment(
    type: CardType,
    text: string,
    comment: string,
    settings: StudioSettings,
): string[] {
    const lines = text.split("\n");
    const last = lines.length - 1;
    const isCallout = type === CardType.Callout;
    if (text.includes(CARD_METADATA_CALLOUT)) {
        lines[last] += ` ${comment}`;
    } else if (settings.useCalloutsForSchedulingComments && !isCallout) {
        lines.push(`${CARD_METADATA_CALLOUT} `, `>  ${comment}`);
    } else if (
        settings.cardCommentOnSameLine &&
        !text.endsWith("```") &&
        !isCallout &&
        type !== CardType.ImageOcclusion
    ) {
        lines[last] += ` ${comment}`;
    } else {
        lines.push(comment);
    }
    return lines;
}

/**
 * Whether the note parser reads `text`, with a schedule comment where the note gets one, back as one question of `type`
 * that takes all of it and the comment. A text that it does not (a line break in a single-line card, a blank line in a
 * multi-line card or a cloze) would be written to the note as another card, or as none, and the schedule comment would
 * end up on the wrong lines. White space at the end of `text` is left out: the text of a tagged card with a schedule
 * ends in the line break before its comment.
 */
export function readsBackAsOneQuestion(
    type: CardType,
    text: string,
    settings: StudioSettings,
): boolean {
    // With card regions on, a multi-line card or a cloze is only found inside a region
    const start = settings.multilineCardStartMarker;
    const inRegion = start !== "" && (isMultiLine(type) || type === CardType.Cloze);
    // The comment has a schedule for each card of the question. With atomic clozes the parser counts them: a paragraph
    // stays one question when its comment has more than the clozes of its last line
    const cardCount = CardFrontBackUtil.expand(type, text, settings).length || 1;
    const comment = `<!--SR:${SCHEDULE_STAND_IN.repeat(cardCount)}-->`;
    const lines = [
        ...(inRegion ? [start] : []),
        ...withScheduleComment(type, text.trimEnd(), comment, settings),
    ];
    const questions = parse(lines.join("\n"), parserOptionsFromSettings(settings));
    return (
        questions.length === 1 &&
        questions[0].cardType === type &&
        questions[0].firstLineNum === (inRegion ? 1 : 0) &&
        questions[0].lastLineNum === lines.length - 1
    );
}
