import { App, FuzzySuggestModal, TFile } from "obsidian";

import { t } from "src/lang/translate";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

/** Whether a vault file is an image that an occlusion card can be drawn on. */
export function isImageFile(file: TFile): boolean {
    return IMAGE_EXTENSIONS.includes(file.extension.toLowerCase());
}

/** The images of the vault, the ones changed last first. */
export function vaultImages(app: App): TFile[] {
    return app.vault
        .getFiles()
        .filter(isImageFile)
        .sort((a, b) => b.stat.mtime - a.stat.mtime);
}

/** Picks one of the vault's images by fuzzy search on its path. */
export class ImageSuggestModal extends FuzzySuggestModal<TFile> {
    private onChoose: (file: TFile) => void;

    constructor(app: App, onChoose: (file: TFile) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder(t("OCCLUSION_PICK_IMAGE"));
    }

    getItems(): TFile[] {
        return vaultImages(this.app);
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.onChoose(file);
    }
}

/** What the masks of a new block make: answers (an `image-occlusion` block) or cloze cards (an `image-cloze` block). */
export type BlockKind = "answers" | "cloze";

/** The kinds a new block can be, answers first: it is what the command made before cloze cards existed. */
export const BLOCK_KINDS: BlockKind[] = ["answers", "cloze"];

/** Picks the kind of a new block. */
export class BlockKindSuggestModal extends FuzzySuggestModal<BlockKind> {
    private onChoose: (kind: BlockKind) => void;

    constructor(app: App, onChoose: (kind: BlockKind) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder(t("IMAGE_CLOZE_PICK_KIND"));
    }

    getItems(): BlockKind[] {
        return BLOCK_KINDS;
    }

    getItemText(kind: BlockKind): string {
        return t(kind === "answers" ? "IMAGE_CLOZE_KIND_ANSWERS" : "IMAGE_CLOZE_KIND_CLOZE");
    }

    onChooseItem(kind: BlockKind): void {
        this.onChoose(kind);
    }
}
