import { CardFrontBackUtil } from "src/cards/expand";
import { CardType } from "src/data/data-structures/card/question";
import { StudioSettings } from "src/data/settings-model";
import { findLineIndexOfSearchStringIgnoringWs } from "src/utils/text";

/** The two sides of a card with a separator, as the edit dialog shows them in two fields. */
export interface CardSides {
    front: string;
    back: string;
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

/**
 * Cuts a question into its sides exactly where the note parser does: a single-line card at the first separator, a
 * multi-line card at the first line that is the separator (whatever its padding). The sides of a multi-line card lose the
 * blank lines around the separator.
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
    const found = isMultiLine(type)
        ? findLineIndexOfSearchStringIgnoringWs(text.split("\n"), separator) >= 0
        : text.includes(separator);
    if (!found) return null;

    const [sides] = CardFrontBackUtil.expand(type, text, settings);
    return isMultiLine(type)
        ? { front: sides.front.trimEnd(), back: sides.back.trimStart() }
        : { front: sides.front, back: sides.back };
}

/** Puts the sides back together; `splitCardText` of the result gives the same sides. */
export function joinCardText(type: CardType, sides: CardSides, settings: StudioSettings): string {
    const separator = separatorOf(type, settings);
    if (separator === null) return sides.front;
    if (!isMultiLine(type)) return sides.front + separator + sides.back;
    const lead = sides.front.endsWith("\n") ? "" : "\n";
    const trail = sides.back.startsWith("\n") ? "" : "\n";
    return sides.front + lead + separator + trail + sides.back;
}
