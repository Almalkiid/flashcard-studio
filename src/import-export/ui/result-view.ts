import { ButtonComponent, Modal } from "obsidian";

import { Summary } from "src/import-export/format-result";
import { t } from "src/lang/translate";

/** Replaces the content of a finished import or export dialog with what happened, and a button to close it. */
export function showResultView(modal: Modal, summary: Summary): void {
    const { contentEl } = modal;
    contentEl.empty();
    contentEl.createEl("p", { text: summary.headline, cls: "fs-anki-result-headline" });
    if (summary.details.length > 0) {
        const list = contentEl.createEl("ul", { cls: "fs-anki-result-details" });
        for (const detail of summary.details) list.createEl("li", { text: detail });
    }
    const buttons = contentEl.createDiv({ cls: "fs-anki-buttons" });
    const close = new ButtonComponent(buttons)
        .setButtonText(t("CLOSE"))
        .setCta()
        .onClick(() => modal.close());
    close.buttonEl.focus();
}
