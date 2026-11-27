import {
    BlockProblem,
    CardField,
    formatImageClozeBlock,
    ImageClozeBlock,
    parseImageClozeBlock,
    readCardField,
} from "src/occlusion/image-cloze-block";
import { cardNumbersOf, nextFreeNumber } from "src/occlusion/image-cloze-cards";
import {
    MaskShape,
    newMaskId,
    OcclusionBlock,
    OcclusionMask,
    OcclusionMode,
} from "src/occlusion/occlusion-block";
import type { Rect } from "src/occlusion/occlusion-geometry";

interface EditorMask extends OcclusionMask {
    /** The index the mask had in the block that was opened, or null for a mask drawn in this editor. */
    origIndex: number | null;
    /** A cloze mask's card field, as typed. */
    fieldText?: string;
    /** A cloze mask's hint. */
    hint?: string;
}

/**
 * What the occlusion editor is editing: the masks, which one is selected, and the shape a new mask gets. Each mask
 * remembers where it was in the block that was opened, so that saving can tell the schedules where their masks went.
 */
export class OcclusionEditorModel {
    image: string;
    mode: OcclusionMode;
    question: string;
    /** The shape the next mask is drawn as. */
    shape: MaskShape = "rect";
    masks: EditorMask[];
    /** The index of the selected mask, or -1. */
    selected = -1;
    /** Answers (an `image-occlusion` block) or cloze cards (an `image-cloze` block): fixed when the editor opens. */
    kind: "answers" | "cloze" = "answers";
    /** For cloze cards: how many cards the text clozes beside the block make. */
    textCards = 0;

    constructor(block: OcclusionBlock) {
        this.image = block.image;
        this.mode = block.mode;
        this.question = block.question;
        this.masks = block.masks.map((mask, index) => ({ ...mask, origIndex: index }));
    }

    select(index: number): void {
        this.selected = index >= 0 && index < this.masks.length ? index : -1;
    }

    /** An editor on an image cloze block, beside text clozes that make `textCards` cards. */
    static fromCloze(block: ImageClozeBlock, textCards: number): OcclusionEditorModel {
        const model = new OcclusionEditorModel({
            image: block.image,
            mode: block.mode,
            question: block.question,
            masks: block.masks.map(({ id, shape, x, y, w, h }) => ({
                id,
                shape,
                x,
                y,
                w,
                h,
                label: "",
            })),
        });
        model.kind = "cloze";
        model.textCards = textCards;
        model.masks.forEach((mask, index) => {
            mask.fieldText = block.masks[index].fieldText;
            mask.hint = block.masks[index].hint;
        });
        return model;
    }

    /** Adds a mask of the chosen shape, selects it and returns its index. A cloze mask gets the lowest free number. */
    addMask(rect: Rect): number {
        const fieldText =
            this.kind === "cloze"
                ? String(nextFreeNumber(this.textCards, this.clozeResult()) ?? "")
                : undefined;
        this.masks.push({
            id: newMaskId(this.masks.map((mask) => mask.id)),
            shape: this.shape,
            ...rect,
            label: "",
            origIndex: null,
            ...(fieldText === undefined ? {} : { fieldText, hint: "" }),
        });
        this.selected = this.masks.length - 1;
        return this.selected;
    }

    setRect(index: number, rect: Rect): void {
        Object.assign(this.masks[index], rect);
    }

    setLabel(label: string): void {
        if (this.selected >= 0) this.masks[this.selected].label = label;
    }

    /** A cloze mask's card field, as typed. */
    setField(text: string): void {
        if (this.selected >= 0) this.masks[this.selected].fieldText = text;
    }

    /** A cloze mask's hint. */
    setHint(text: string): void {
        if (this.selected >= 0) this.masks[this.selected].hint = text;
    }

    /** The masks whose card field cannot be read, by index. */
    fieldProblems(): number[] {
        return this.masks.flatMap((mask, index) =>
            readCardField(mask.fieldText ?? "") === null ? [index] : [],
        );
    }

    /** The question's card numbers with the masks as they are now (a mask that cannot be read asks nothing). */
    cardNumbers(): number[] {
        return cardNumbersOf(this.textCards, this.clozeResult());
    }

    /** For a block alone: no mask is asked on any card, so the block would make no cards. */
    nothingAsked(): boolean {
        return this.textCards === 0 && this.cardNumbers().length === 0;
    }

    /** The numbers of `before` that no card has any more: their schedules go at the question's next write. */
    unusedNumbers(before: number[]): number[] {
        const now = new Set(this.cardNumbers());
        return before.filter((k) => !now.has(k));
    }

    /**
     * What keeps the block from reading back as it would be written, or null: a hint that holds a comment, as well as
     * a card field that cannot be read. Checked on the block as it would be saved, so nothing unreadable is written.
     */
    blockProblem(): BlockProblem | null {
        const read = parseImageClozeBlock(formatImageClozeBlock(this.clozeResult()));
        return read.ok === false ? read.problem : null;
    }

    /** The image cloze block to save. A card field that cannot be read is written as typed and read as asking nothing. */
    clozeResult(): ImageClozeBlock {
        return {
            image: this.image,
            mode: this.mode,
            question: this.question,
            masks: this.masks.map(({ id, shape, x, y, w, h, fieldText, hint }) => {
                const text = fieldText ?? "";
                const field: CardField = readCardField(text) ?? { kind: "numbers", numbers: [] };
                return { id, field, fieldText: text, shape, x, y, w, h, hint: hint ?? "" };
            }),
        };
    }

    /** Removes the selected mask. False when none is selected. */
    removeSelected(): boolean {
        if (this.selected < 0) return false;
        this.masks.splice(this.selected, 1);
        this.selected = -1;
        return true;
    }

    /** The block to save, and for each of its masks the index it had in the block that was opened (null: new). */
    result(): { block: OcclusionBlock; oldIndexOfNew: (number | null)[] } {
        return {
            block: {
                image: this.image,
                mode: this.mode,
                question: this.question,
                masks: this.masks.map(({ origIndex: _origIndex, ...mask }) => ({ ...mask })),
            },
            oldIndexOfNew: this.masks.map((mask) => mask.origIndex),
        };
    }
}
