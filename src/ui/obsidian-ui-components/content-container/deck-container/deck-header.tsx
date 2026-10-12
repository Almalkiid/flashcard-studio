import "src/ui/obsidian-ui-components/content-container/deck-container/deck-header.css";
import { DropdownComponent, Platform, setIcon } from "obsidian";

import { t } from "src/lang/translate";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { createCloseButton } from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar-buttons/icon-buttons";
import { makePressable } from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";

const MODE_VALUES: Record<string, FlashcardReviewMode> = {
    Review: FlashcardReviewMode.Review,
    Cram: FlashcardReviewMode.Cram,
};

/** The bar above the deck list: its title, the Review/Cram switch, custom study, and the close button of a modal. */
export default class DeckListHeaderComponent {
    private readonly title: HTMLDivElement;
    private readonly modeDropdown: DropdownComponent;

    constructor(
        parentEl: HTMLElement,
        changeReviewMode: (mode: FlashcardReviewMode) => void,
        closeModal?: () => void,
        openCustomStudy?: () => void,
    ) {
        const header = parentEl.createDiv({ cls: "fs-deck-list-header fs-header" });
        setIcon(header.createDiv({ cls: "fs-deck-icon" }), "layers");
        this.title = header.createDiv({ cls: "fs-title", text: t("DECKS") });
        header.createDiv({ cls: "fs-flex-spacer" });

        this.modeDropdown = new DropdownComponent(header)
            .addOption("Review", t("REVIEW_MODE"))
            .addOption("Cram", t("CRAM_MODE"))
            .onChange((value) => changeReviewMode(MODE_VALUES[value]));

        if (openCustomStudy !== undefined) {
            const button = header.createDiv({
                cls: "fs-custom-study-button clickable-icon",
                attr: { "aria-label": t("CUSTOM_STUDY") },
            });
            setIcon(button, "list-filter");
            makePressable(button, openCustomStudy);
        }

        if (closeModal) {
            createCloseButton(
                header,
                closeModal,
                Platform.isPhone ? ["mod-raised", "clickable-icon"] : ["clickable-icon"],
            );
        }
    }

    /** Shows the mode without telling anyone that it changed. */
    public updateReviewMode(mode: FlashcardReviewMode): void {
        this.modeDropdown.setValue(mode === FlashcardReviewMode.Cram ? "Cram" : "Review");
    }

    /** A custom study session is titled as such, instead of "Decks". */
    public setCustomStudyActive(active: boolean): void {
        this.title.setText(active ? t("CUSTOM_STUDY") : t("DECKS"));
    }
}
