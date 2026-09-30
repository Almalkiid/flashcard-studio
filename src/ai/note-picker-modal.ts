import { App, FuzzySuggestModal, TFile } from "obsidian";

import { t } from "src/lang/helpers";

/**
 * Asks for a note, the most recently changed first, for the desktop's "Create with AI", which has no note open to
 * start from.
 */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
    private readonly onPick: (file: TFile) => void;

    constructor(app: App, onPick: (file: TFile) => void) {
        super(app);
        this.onPick = onPick;
        this.setPlaceholder(t("AI_PICK_NOTE"));
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.onPick(file);
    }
}
