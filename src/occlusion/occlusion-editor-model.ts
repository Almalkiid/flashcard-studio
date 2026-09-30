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

    constructor(block: OcclusionBlock) {
        this.image = block.image;
        this.mode = block.mode;
        this.question = block.question;
        this.masks = block.masks.map((mask, index) => ({ ...mask, origIndex: index }));
    }

    select(index: number): void {
        this.selected = index >= 0 && index < this.masks.length ? index : -1;
    }

    /** Adds a mask of the chosen shape, selects it and returns its index. */
    addMask(rect: Rect): number {
        this.masks.push({
            id: newMaskId(this.masks.map((mask) => mask.id)),
            shape: this.shape,
            ...rect,
            label: "",
            origIndex: null,
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
