import { App, FuzzySuggestModal } from "obsidian";

import { t } from "src/lang/translate";

/** Asks which deck to review, by name. */
export class ReviewDeckSelectionModal extends FuzzySuggestModal<string> {
    public submitCallback: (deckKey: string) => void = () => {};

    constructor(
        app: App,
        private readonly deckKeys: string[],
    ) {
        super(app);
        this.setPlaceholder(t("REVIEW_DECK_PLACEHOLDER"));
    }

    getItems(): string[] {
        return this.deckKeys;
    }

    getItemText(item: string): string {
        return item;
    }

    onChooseItem(deckKey: string): void {
        this.submitCallback(deckKey);
    }
}
