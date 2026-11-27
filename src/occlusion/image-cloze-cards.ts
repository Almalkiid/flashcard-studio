/**
 * Which cards an image cloze block makes, and what each mask does on each of them. Card k is card number k, the same
 * number text clozes use: a note's text clozes and its masks are one set of cards, as in Anki, where card numbers are
 * collected from every field of a note.
 */
import { ImageClozeBlock, ImageClozeMask } from "src/occlusion/image-cloze-block";
import { OcclusionMode } from "src/occlusion/occlusion-block";

/** On a card, a mask is asked (`a`), hidden (`h`) or shown (`s`): the letters of overlapping clozes. */
export type MaskAction = "a" | "h" | "s";

/** The highest card number a mask can name. */
export const MAX_MASK_CARD = 99;

/**
 * What a mask does on card k. A number field asks on the cards it lists; on the others the mask is hidden in
 * "hide all" and shown in "hide one", and a `0` mask is hidden on every card (Anki's 0). A letter field has one letter
 * per card, and a card past its end shows the mask, as a short overlapping cloze does.
 */
export function actionOf(mask: ImageClozeMask, k: number, mode: OcclusionMode): MaskAction {
    const field = mask.field;
    if (field.kind === "letters") return (field.seq[k - 1] ?? "s") as MaskAction;
    if (field.kind === "numbers" && field.numbers.includes(k)) return "a";
    return field.kind === "zero" || mode === "hide-all" ? "h" : "s";
}

/** The numbers a block asks on: those of its number fields, and every place where a letter field has an `a`. */
function askedNumbers(block: ImageClozeBlock): number[] {
    return block.masks.flatMap(({ field }) => {
        if (field.kind === "numbers") return field.numbers;
        if (field.kind === "letters")
            return [...field.seq].flatMap((letter, at) => (letter === "a" ? [at + 1] : []));
        return [];
    });
}

/**
 * The card numbers of a question, ascending: every text card (1 to `textCards`, gaps included, as the text clozes
 * make them) and every number the block asks on. A block alone makes no card that asks nothing.
 */
export function cardNumbersOf(textCards: number, block: ImageClozeBlock): number[] {
    const numbers = new Set(askedNumbers(block));
    for (let k = 1; k <= textCards; k++) numbers.add(k);
    return [...numbers].sort((a, b) => a - b);
}

/** The lowest card number from 1 to 99 that the question does not use yet, for a new mask; null when all are used. */
export function nextFreeNumber(textCards: number, block: ImageClozeBlock): number | null {
    const used = new Set(cardNumbersOf(textCards, block));
    for (let k = 1; k <= MAX_MASK_CARD; k++) if (!used.has(k)) return k;
    return null;
}
