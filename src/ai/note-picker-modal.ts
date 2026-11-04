import { App, FuzzyMatch, FuzzySuggestModal, TFile } from "obsidian";

import { t } from "src/lang/translate";

export interface NotePickerOptions {
    /** The prompt in the search field; "Choose a note to make cards from" by default. */
    placeholder?: string;
    /** A short second line for a note, such as how many questions it can give. */
    detail?: (file: TFile) => string;
}

/**
 * Asks for a note, the most recently changed first: for the desktop's "Create with AI", which has no note open to
 * start from, and for the notes of an exam. The notes `leaveOut` names are not offered: for card generation the
 * plugin's own files (the review log, the exams), which are not notes to make cards from.
 */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
    private readonly onPick: (file: TFile) => void;
    /** Notes not to offer. */
    private readonly leaveOut: (path: string) => boolean;
    private readonly detail: ((file: TFile) => string) | undefined;

    constructor(
        app: App,
        onPick: (file: TFile) => void,
        leaveOut: (path: string) => boolean,
        options: NotePickerOptions = {},
    ) {
        super(app);
        this.onPick = onPick;
        this.leaveOut = leaveOut;
        this.detail = options.detail;
        this.setPlaceholder(options.placeholder ?? t("AI_PICK_NOTE"));
    }

    getItems(): TFile[] {
        return this.app.vault
            .getMarkdownFiles()
            .filter((file) => !this.leaveOut(file.path))
            .sort((a, b) => b.stat.mtime - a.stat.mtime);
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
        super.renderSuggestion(match, el);
        const text = this.detail?.(match.item) ?? "";
        if (text !== "") el.createDiv({ cls: "suggestion-note", text });
    }

    onChooseItem(file: TFile): void {
        this.onPick(file);
    }
}
