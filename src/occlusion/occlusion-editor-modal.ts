import "src/occlusion/occlusion.css";
import { App, Modal, Notice, setIcon } from "obsidian";

import { t } from "src/lang/helpers";
import {
    imagePathOf,
    MaskShape,
    OcclusionBlock,
    OcclusionMode,
} from "src/occlusion/occlusion-block";
import { OcclusionEditorModel } from "src/occlusion/occlusion-editor-model";
import {
    Handle,
    HANDLES,
    hitHandle,
    hitMask,
    isBigEnough,
    moveRect,
    Point,
    Rect,
    rectFromPoints,
    resizeRect,
} from "src/occlusion/occlusion-geometry";
import {
    fitStageToImage,
    percent,
    plainLabel,
    resolveImagePath,
} from "src/occlusion/occlusion-view";

export interface OcclusionEditorResult {
    block: OcclusionBlock;
    /** For each mask of the block, the index it had in the block that was opened, or null for a new mask. */
    oldIndexOfNew: (number | null)[];
}

/** What a pointer that is down is doing to the picture. */
type Drag =
    | { kind: "draw"; start: Point; rect: Rect; draft: HTMLElement }
    | { kind: "move"; start: Point; orig: Rect; index: number }
    | { kind: "resize"; start: Point; orig: Rect; index: number; handle: Handle };

const HANDLE_CURSOR: Record<Handle, string> = {
    nw: "nwse",
    se: "nwse",
    ne: "nesw",
    sw: "nesw",
    n: "ns",
    s: "ns",
    e: "ew",
    w: "ew",
};

/**
 * The editor of an occlusion block: the picture, and masks to draw on it with the mouse or a finger (pointer events).
 * Drag on empty space to draw a mask, drag a mask to move it, drag its handles to resize it. The selected mask has
 * an answer that is typed under the picture.
 */
export class OcclusionEditorModal extends Modal {
    private model: OcclusionEditorModel;
    private sourcePath: string;
    private onSave: (result: OcclusionEditorResult) => void | Promise<void>;

    private stage: HTMLElement | null = null;
    private layer: HTMLElement | null = null;
    private labelInput: HTMLInputElement | null = null;
    private deleteButton: HTMLButtonElement | null = null;
    private chips: HTMLElement | null = null;
    private count: HTMLElement | null = null;
    private drag: Drag | null = null;

    /**
     * @param sourcePath - The note the block is in, which its image link is resolved from.
     * @param block - The block to edit; a new one has no masks.
     * @param onSave - Called with the edited block when Save is pressed.
     */
    constructor(
        app: App,
        sourcePath: string,
        block: OcclusionBlock,
        onSave: (result: OcclusionEditorResult) => void | Promise<void>,
    ) {
        super(app);
        this.sourcePath = sourcePath;
        this.model = new OcclusionEditorModel(block);
        this.onSave = onSave;
    }

    onOpen(): void {
        this.modalEl.addClass("fs-studio", "fs-occ-editor-modal");
        this.setTitle(t("OCCLUSION_EDITOR_TITLE"));
        const { contentEl } = this;
        contentEl.empty();
        const root = contentEl.createDiv({ cls: "fs-occ-editor" });

        const file = resolveImagePath(this.app, this.model.image, this.sourcePath);
        if (file === null) {
            root.createDiv({
                cls: "fs-occ-missing",
                text: t("OCCLUSION_IMAGE_MISSING", { path: imagePathOf(this.model.image) }),
            });
            this.buildFooter(root, false);
            return;
        }

        this.buildToolbar(root);
        this.buildStage(root, this.app.vault.getResourcePath(file), file.name);
        this.buildFields(root);
        this.buildFooter(root, true);

        // Delete removes the selected mask, unless the key is for a text field
        contentEl.addEventListener("keydown", (event) => {
            if (event.key !== "Delete" && event.key !== "Backspace") return;
            if (event.target instanceof HTMLInputElement) return;
            event.preventDefault();
            this.deleteSelected();
        });
        this.refresh();
    }

    onClose(): void {
        this.drag = null;
        this.contentEl.empty();
    }

    // #region -> Building

    private buildToolbar(root: HTMLElement): void {
        const bar = root.createDiv({ cls: "fs-occ-toolbar" });
        this.segmented<MaskShape>(
            bar,
            [
                { value: "rect", label: t("OCCLUSION_SHAPE_RECT"), icon: "square" },
                { value: "ellipse", label: t("OCCLUSION_SHAPE_ELLIPSE"), icon: "circle" },
            ],
            () => this.model.shape,
            (shape) => (this.model.shape = shape),
        );
        this.segmented<OcclusionMode>(
            bar,
            [
                { value: "hide-all", label: t("OCCLUSION_MODE_HIDE_ALL"), icon: "layers" },
                { value: "hide-one", label: t("OCCLUSION_MODE_HIDE_ONE"), icon: "square-dashed" },
            ],
            () => this.model.mode,
            (mode) => (this.model.mode = mode),
        );
        bar.createDiv({ cls: "fs-occ-toolbar-spacer" });
        this.count = bar.createSpan({ cls: "fs-occ-count" });

        this.deleteButton = bar.createEl("button", {
            cls: "fs-occ-btn is-danger",
            attr: { type: "button", "aria-label": t("OCCLUSION_DELETE_MASK") },
        });
        setIcon(this.deleteButton.createSpan(), "trash-2");
        this.deleteButton.createSpan({ text: t("OCCLUSION_DELETE_MASK") });
        this.deleteButton.addEventListener("click", () => this.deleteSelected());
    }

    /** A choice of one of a few, as a pill. */
    private segmented<T extends string>(
        parent: HTMLElement,
        options: { value: T; label: string; icon: string }[],
        get: () => T,
        set: (value: T) => void,
    ): void {
        const group = parent.createDiv({ cls: "fs-occ-seg", attr: { role: "radiogroup" } });
        const sync = () =>
            buttons.forEach((button, i) =>
                button.setAttribute("aria-checked", String(options[i].value === get())),
            );
        const buttons = options.map((option) => {
            const button = group.createEl("button", {
                cls: "fs-occ-seg-btn",
                attr: { type: "button", role: "radio" },
            });
            setIcon(button.createSpan(), option.icon);
            button.createSpan({ text: option.label });
            button.addEventListener("click", () => {
                set(option.value);
                sync();
            });
            return button;
        });
        sync();
    }

    private buildStage(root: HTMLElement, src: string, alt: string): void {
        const wrap = root.createDiv({ cls: "fs-occ-editor-stagewrap" });
        const stage = wrap.createDiv({ cls: "fs-occ-stage is-editing", attr: { tabindex: "0" } });
        const img = stage.createEl("img", {
            cls: "fs-occ-image",
            attr: { src, alt, draggable: "false" },
        });
        fitStageToImage(stage, img);
        this.layer = stage.createDiv({ cls: "fs-occ-layer" });
        this.stage = stage;

        stage.addEventListener("pointerdown", (event) => this.onPointerDown(event));
        stage.addEventListener("pointermove", (event) => this.onPointerMove(event));
        stage.addEventListener("pointerup", (event) => this.endDrag(true, event.pointerType));
        stage.addEventListener("pointercancel", () => this.endDrag(false, "mouse"));
        // A long press on a phone would open a menu in the middle of a drag
        stage.addEventListener("contextmenu", (event) => event.preventDefault());
    }

    private buildFields(root: HTMLElement): void {
        const fields = root.createDiv({ cls: "fs-occ-fields" });

        const labelField = fields.createEl("label", { cls: "fs-occ-field" });
        labelField.createSpan({ cls: "fs-occ-field-label", text: t("OCCLUSION_LABEL_FIELD") });
        this.labelInput = labelField.createEl("input", {
            cls: "fs-occ-input",
            attr: { type: "text", placeholder: t("OCCLUSION_LABEL_PLACEHOLDER") },
        });
        this.labelInput.addEventListener("input", () => {
            this.model.setLabel(this.labelInput?.value ?? "");
            this.renderMasks();
            this.renderChips();
        });

        const questionField = fields.createEl("label", { cls: "fs-occ-field" });
        questionField.createSpan({
            cls: "fs-occ-field-label",
            text: t("OCCLUSION_QUESTION_FIELD"),
        });
        const question = questionField.createEl("input", {
            cls: "fs-occ-input",
            attr: { type: "text", placeholder: t("OCCLUSION_DEFAULT_QUESTION") },
        });
        question.value = this.model.question;
        question.addEventListener("input", () => (this.model.question = question.value));

        this.chips = root.createDiv({ cls: "fs-occ-chips" });
    }

    private buildFooter(root: HTMLElement, canSave: boolean): void {
        const footer = root.createDiv({ cls: "fs-occ-footer" });
        if (canSave) footer.createDiv({ cls: "fs-occ-hint", text: t("OCCLUSION_HINT") });
        else footer.createDiv({ cls: "fs-occ-hint" });

        const cancel = footer.createEl("button", {
            cls: "fs-occ-btn",
            text: t("CANCEL"),
            attr: { type: "button" },
        });
        cancel.addEventListener("click", () => this.close());

        const save = footer.createEl("button", {
            cls: "fs-occ-btn is-primary",
            text: t("SAVE"),
            attr: { type: "button" },
        });
        save.disabled = !canSave;
        save.addEventListener("click", () => this.save());
    }

    // #endregion

    // #region -> Drawing what the model holds

    /** Redraws everything that shows the model: the masks, the answer field, the buttons, the chips. */
    private refresh(): void {
        this.renderMasks();
        const selected = this.model.masks[this.model.selected];
        if (this.labelInput !== null) {
            this.labelInput.disabled = selected === undefined;
            this.labelInput.value = selected?.label ?? "";
        }
        if (this.deleteButton !== null) this.deleteButton.disabled = selected === undefined;
        this.count?.setText(t("OCCLUSION_MASK_COUNT", { n: this.model.masks.length }));
        this.renderChips();
    }

    private placeMask(el: HTMLElement, rect: Rect): void {
        el.setCssProps({
            "--fs-occ-x": percent(rect.x),
            "--fs-occ-y": percent(rect.y),
            "--fs-occ-w": percent(rect.w),
            "--fs-occ-h": percent(rect.h),
        });
    }

    private renderMasks(): void {
        const layer = this.layer;
        if (layer === null) return;
        layer.empty();
        this.model.masks.forEach((mask, index) => {
            const selected = index === this.model.selected;
            const el = layer.createDiv({ cls: "fs-occ-emask" });
            el.toggleClass("is-ellipse", mask.shape === "ellipse");
            el.toggleClass("is-selected", selected);
            this.placeMask(el, mask);
            el.createSpan({ cls: "fs-occ-emask-num", text: String(index + 1) });
            if (selected) {
                for (const handle of HANDLES) el.createDiv({ cls: `fs-occ-handle is-${handle}` });
            }
        });
    }

    private renderChips(): void {
        const chips = this.chips;
        if (chips === null) return;
        chips.empty();
        this.model.masks.forEach((mask, index) => {
            const chip = chips.createEl("button", { cls: "fs-occ-chip", attr: { type: "button" } });
            chip.toggleClass("is-selected", index === this.model.selected);
            chip.createSpan({ cls: "fs-occ-chip-num", text: String(index + 1) });
            chip.createSpan({
                cls: "fs-occ-chip-text",
                text: plainLabel(mask.label) || t("OCCLUSION_NO_LABEL"),
            });
            chip.addEventListener("click", () => {
                this.model.select(index);
                this.refresh();
            });
        });
    }

    // #endregion

    // #region -> Pointer

    /** Where a pointer is on the picture, as fractions of it. */
    private pointOf(event: PointerEvent): Point {
        const box = this.stage?.getBoundingClientRect();
        if (box === undefined || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
        return {
            x: (event.clientX - box.left) / box.width,
            y: (event.clientY - box.top) / box.height,
        };
    }

    private stageSize(): { w: number; h: number } {
        const box = this.stage?.getBoundingClientRect();
        return { w: box?.width ?? 0, h: box?.height ?? 0 };
    }

    private onPointerDown(event: PointerEvent): void {
        if (this.stage === null || this.layer === null) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        this.stage.focus({ preventScroll: true });
        this.stage.setPointerCapture(event.pointerId);

        const point = this.pointOf(event);
        const selected = this.model.masks[this.model.selected];
        // A finger is bigger than a mouse pointer, so the handles are easier to hit
        const radius = event.pointerType === "touch" ? 22 : 12;
        if (selected !== undefined) {
            const handle = hitHandle(selected, point, this.stageSize(), radius);
            if (handle !== null) {
                const { x, y, w, h } = selected;
                this.drag = {
                    kind: "resize",
                    start: point,
                    orig: { x, y, w, h },
                    index: this.model.selected,
                    handle,
                };
                return;
            }
        }

        const hit = hitMask(this.model.masks, point);
        if (hit >= 0) {
            this.model.select(hit);
            const { x, y, w, h } = this.model.masks[hit];
            this.drag = { kind: "move", start: point, orig: { x, y, w, h }, index: hit };
            this.refresh();
            return;
        }

        this.model.select(-1);
        this.refresh();
        const draft = this.layer.createDiv({ cls: "fs-occ-emask is-draft" });
        draft.toggleClass("is-ellipse", this.model.shape === "ellipse");
        this.drag = { kind: "draw", start: point, rect: rectFromPoints(point, point), draft };
        this.placeMask(draft, this.drag.rect);
    }

    private onPointerMove(event: PointerEvent): void {
        const drag = this.drag;
        if (drag === null) {
            this.showCursor(event);
            return;
        }
        const point = this.pointOf(event);
        const dx = point.x - drag.start.x;
        const dy = point.y - drag.start.y;
        if (drag.kind === "draw") {
            drag.rect = rectFromPoints(drag.start, point);
            this.placeMask(drag.draft, drag.rect);
        } else if (drag.kind === "move") {
            this.model.setRect(drag.index, moveRect(drag.orig, dx, dy));
            this.renderMasks();
        } else {
            this.model.setRect(drag.index, resizeRect(drag.orig, drag.handle, dx, dy));
            this.renderMasks();
        }
    }

    /** With a mouse: the pointer says what a drag here would do. */
    private showCursor(event: PointerEvent): void {
        if (this.stage === null || event.pointerType !== "mouse") return;
        const point = this.pointOf(event);
        const selected = this.model.masks[this.model.selected];
        const handle =
            selected === undefined ? null : hitHandle(selected, point, this.stageSize(), 12);
        let cursor = "";
        if (handle !== null) cursor = HANDLE_CURSOR[handle];
        else if (hitMask(this.model.masks, point) >= 0) cursor = "move";
        this.stage.setAttribute("data-cursor", cursor);
    }

    private endDrag(commit: boolean, pointerType: string): void {
        const drag = this.drag;
        this.drag = null;
        if (drag === null) return;

        if (drag.kind !== "draw") {
            this.refresh();
            return;
        }
        drag.draft.remove();
        // A tap, or a slip of the hand, is not a mask
        if (commit && isBigEnough(drag.rect)) {
            this.model.addMask(drag.rect);
            this.refresh();
            // On a phone the keyboard would cover the picture
            if (pointerType !== "touch") this.labelInput?.focus();
        }
    }

    // #endregion

    private deleteSelected(): void {
        if (this.model.removeSelected()) this.refresh();
    }

    private save(): void {
        if (this.model.masks.length === 0) {
            new Notice(t("OCCLUSION_NEEDS_MASK"));
            return;
        }
        const result = this.model.result();
        this.close();
        void Promise.resolve(this.onSave(result)).catch((error: unknown) => {
            console.error("Image occlusion: could not save", error);
            new Notice(t("OCCLUSION_BLOCK_NOT_FOUND"));
        });
    }
}
