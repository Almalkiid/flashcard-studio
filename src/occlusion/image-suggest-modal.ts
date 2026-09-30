import { App, FuzzySuggestModal, TFile } from "obsidian";

import { t } from "src/lang/helpers";

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
