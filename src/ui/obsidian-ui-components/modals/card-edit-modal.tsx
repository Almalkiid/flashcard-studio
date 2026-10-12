import "src/ui/obsidian-ui-components/modals/card-edit-modal.css";
import { App, Modal } from "obsidian";

import { Card } from "src/data/data-structures/card/flashcard";
import { CardType } from "src/data/data-structures/card/question";
import { StudioSettings } from "src/data/settings-model";
import { t } from "src/lang/translate";
import {
    CardSides,
    joinCardText,
    splitCardText,
} from "src/ui/obsidian-ui-components/modals/card-text-split";
import StudioButton from "src/ui/studio-button";
import { TextDirection } from "src/utils/text";

/** What the dialog rejects with when it is closed without saving. */
export class EditCancelled extends Error {
    constructor() {
        super(t("NO_INPUT"));
        this.name = "EditCancelled";
    }
}

/**
 * Edits the text of a card: one field for a card that is a single text (cloze, callout), two for a card with a front and
 * a back. The sides are cut and put together by the same rules as the parser, so saving gives back what was there.
 */
export class FlashcardEditModal extends Modal {
    private readonly type: CardType;
    private readonly sides: CardSides | null;
    private frontField!: HTMLTextAreaElement;
    private backField!: HTMLTextAreaElement;
    private saveButton!: StudioButton;
    private settled = false;
    private resolvePromise!: (text: string) => void;
    private rejectPromise!: (reason?: unknown) => void;

    /** Opens the dialog. Resolves with the new text of the question when saved, rejects with `EditCancelled` otherwise. */
    public static Prompt(
        app: App,
        settings: StudioSettings,
        currentCard: Card,
        placeholder: string,
        textDirection: TextDirection,
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const modal = new FlashcardEditModal(
                app,
                settings,
                currentCard,
                placeholder,
                textDirection,
            );
            modal.rejectPromise = reject;
            modal.resolvePromise = resolve;
            modal.open();
        });
    }

    constructor(
        app: App,
        private readonly settings: StudioSettings,
        currentCard: Card,
        private readonly text: string,
        private readonly textDirection: TextDirection,
    ) {
        super(app);
        this.type = currentCard.question.questionType;
        this.sides = splitCardText(this.type, text, settings);
    }

    onOpen(): void {
        const { contentEl, sides } = this;
        this.modalEl.addClasses(["fs-modal", "fs-edit-modal"]);
        contentEl.addClass("fs-edit-view");
        contentEl.createDiv({ cls: "fs-title", text: t("EDIT_CARD") });

        const oneField = sides === null;
        this.frontField = this.createField(
            sides?.front ?? this.text,
            oneField ? t("EDIT_CARD") : t("EDIT_FIELD_FRONT"),
        );
        this.backField = this.createField(sides?.back ?? "", t("EDIT_FIELD_BACK"));
        this.backField.toggleClass("fs-is-hidden", oneField);

        const row = contentEl.createDiv({ cls: "fs-response" });
        const button = (extra: string[], props: { text?: string; onClick?: () => void }) =>
            new StudioButton(row, { ...props, classNames: ["fs-response-button", ...extra] });
        this.saveButton = button(["fs-save-button", "fs-bg-green"], {
            text: t("SAVE"),
            onClick: () => this.save(),
        });
        // Fills the middle of the three columns, so Save and Cancel sit at the two ends
        const filler = button(["fs-dummy-button"], {});
        filler.buttonEl.setAttribute("tabindex", "-1");
        filler.buttonEl.setAttribute("aria-hidden", "true");
        button(["fs-cancel-button", "fs-bg-red"], {
            text: t("CANCEL"),
            onClick: () => this.close(),
        });

        this.frontField.focus();
    }

    onClose(): void {
        this.contentEl.empty();
        if (this.settled) return;
        this.settled = true;
        this.rejectPromise(new EditCancelled());
    }

    private createField(value: string, label: string): HTMLTextAreaElement {
        const field = this.contentEl.createEl("textarea", {
            cls: "fs-input",
            attr: { "aria-label": label },
        });
        field.value = value;
        if (this.textDirection === TextDirection.Rtl) field.setAttribute("dir", "rtl");
        field.addEventListener("input", () => this.updateSaveEnabled());
        field.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                this.save();
            }
        });
        return field;
    }

    /** A card with an empty side would be saved as a card that cannot be read back. */
    private isComplete(): boolean {
        const used = this.sides ? [this.frontField, this.backField] : [this.frontField];
        return used.every(({ value }) => value.trim().length > 0);
    }

    private updateSaveEnabled(): void {
        this.saveButton.setDisabled(!this.isComplete());
    }

    private save(): void {
        if (this.settled || !this.isComplete()) return;
        this.settled = true;
        const text =
            this.sides === null
                ? this.frontField.value
                : joinCardText(
                      this.type,
                      { front: this.frontField.value, back: this.backField.value },
                      this.settings,
                  );
        this.resolvePromise(text);
        this.close();
    }
}
