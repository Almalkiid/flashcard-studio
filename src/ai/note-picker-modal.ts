import { App, FuzzySuggestModal, TFile } from "obsidian";

import { t } from "src/lang/helpers";

/**
 * Asks for a note, the most recently changed first, for the desktop's "Create with AI", which has no note open to
 * start from. The plugin's own files (the review log, the exams) are not notes to make cards from, and are left out.
 */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
    private readonly onPick: (file: TFile) => void;
    private readonly isPluginFile: (path: string) => boolean;

    constructor(app: App, onPick: (file: TFile) => void, isPluginFile: (path: string) => boolean) {
        super(app);
        this.onPick = onPick;
        this.isPluginFile = isPluginFile;
        this.setPlaceholder(t("AI_PICK_NOTE"));
    }

    getItems(): TFile[] {
        return this.app.vault
            .getMarkdownFiles()
            .filter((file) => !this.isPluginFile(file.path))
            .sort((a, b) => b.stat.mtime - a.stat.mtime);
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.onPick(file);
    }
}
