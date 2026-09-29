import { ButtonComponent, Modal } from "obsidian";

import { Summary } from "src/import-export/format-result";
import { t } from "src/lang/helpers";

/** Replaces the content of a finished import or export dialog with what happened, and a button to close it. */
export function showResultView(modal: Modal, summary: Summary): void {
    const { contentEl } = modal;
    contentEl.empty();
    contentEl.createEl("p", { text: summary.headline, cls: "sr-anki-result-headline" });
    if (summary.details.length > 0) {
        const list = contentEl.createEl("ul", { cls: "sr-anki-result-details" });
        for (const detail of summary.details) list.createEl("li", { text: detail });
    }
    const buttons = contentEl.createDiv({ cls: "sr-anki-buttons" });
    const close = new ButtonComponent(buttons)
        .setButtonText(t("CLOSE"))
        .setCta()
        .onClick(() => modal.close());
    close.buttonEl.focus();
}
