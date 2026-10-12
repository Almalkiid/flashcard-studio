import "src/ui/obsidian-ui-components/modals/confirm-modal.css";
import { App, Modal, Notice, Setting } from "obsidian";

import { t } from "src/lang/translate";
import { singleFlight } from "src/ui/single-flight";

/**
 * Asks before something that cannot be undone. Confirm runs the action once however often it is pressed, and closes the
 * dialog when the action is done, whether it worked or not.
 */
export class ConfirmationModal extends Modal {
    constructor(
        app: App,
        title: string,
        description: string,
        private readonly confirmationMessage: string = "",
        private readonly onConfirm?: () => unknown,
        private readonly onClosed?: () => void,
    ) {
        super(app);
        const { titleEl, contentEl } = this;
        titleEl.setText(title);
        titleEl.addClass("fs-confirmation-modal-header");
        contentEl.addClass("fs-confirmation-modal-content");
        contentEl.setText(description);

        const confirm = singleFlight(() => this.run());
        const row = new Setting(contentEl).setClass("fs-confirmation-modal-button-container");
        row.addButton((button) =>
            button.setButtonText(t("CONFIRM")).onClick(() => {
                button.setDisabled(true);
                void confirm();
            }),
        );
        row.addButton((button) => button.setButtonText(t("CANCEL")).onClick(() => this.close()));
        // The destructive look, and the hook that the tests and themes use
        contentEl.querySelector("button")?.addClass("mod-warning");
    }

    onClose(): void {
        this.onClosed?.();
    }

    private async run(): Promise<void> {
        // The message comes first: the action may take a while
        if (this.confirmationMessage !== "") new Notice(this.confirmationMessage);
        try {
            await this.onConfirm?.();
        } catch (error) {
            console.error("Flashcard Studio: the confirmed action failed", error);
        } finally {
            this.close();
        }
    }
}
