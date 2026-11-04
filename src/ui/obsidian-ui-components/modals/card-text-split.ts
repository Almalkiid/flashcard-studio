import { CardFrontBackUtil } from "src/cards/expand";
import { CardType } from "src/data/data-structures/card/question";
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
