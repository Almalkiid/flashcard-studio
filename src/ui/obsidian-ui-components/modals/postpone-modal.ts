import { App, Modal, Notice, Setting } from "obsidian";

import { t } from "src/lang/helpers";

const MAX_POSTPONE_DAYS = 365;
const DEFAULT_POSTPONE_DAYS = 7;

/**
 * Asks how many days to postpone the due reviews by, showing how many cards that moves, and confirms first.
 */
export class PostponeModal extends Modal {
    private count: number;
    private postpone: (days: number) => Promise<number>;

    /**
     * @param count - How many cards are due today or overdue.
     * @param postpone - Moves the cards and returns how many were moved.
     */
    constructor(app: App, count: number, postpone: (days: number) => Promise<number>) {
        super(app);
        this.count = count;
        this.postpone = postpone;
    }

    onOpen(): void {
        this.modalEl.addClass("sr-postpone-modal");
        this.setTitle(t("POSTPONE_REVIEWS"));
        const { contentEl } = this;
        contentEl.empty();

        if (this.count === 0) {
            contentEl.createEl("p", { text: t("POSTPONE_NONE") });
            new Setting(contentEl).addButton((button) =>
                button.setButtonText(t("CANCEL")).onClick(() => this.close()),
            );
            return;
        }

        contentEl.createEl("p", {
            cls: "sr-postpone-count",
            text: t("POSTPONE_COUNT", { count: this.count }),
        });

        let daysInput: HTMLInputElement | null = null;
        new Setting(contentEl)
            .setName(t("POSTPONE_DAYS"))
            .setDesc(t("POSTPONE_DAYS_DESC"))
            .addText((text) => {
                text.setValue(String(DEFAULT_POSTPONE_DAYS));
                text.inputEl.type = "number";
                text.inputEl.min = "1";
                text.inputEl.max = String(MAX_POSTPONE_DAYS);
                text.inputEl.step = "1";
                daysInput = text.inputEl;
            });

        new Setting(contentEl)
            .addButton((button) =>
                button
                    .setButtonText(t("POSTPONE_CONFIRM"))
                    .setCta()
                    .onClick(async () => {
                        const days = Number(daysInput?.value);
                        if (!Number.isInteger(days) || days < 1 || days > MAX_POSTPONE_DAYS) {
                            new Notice(
                                t("INVALID_WHOLE_NUMBER", { min: 1, max: MAX_POSTPONE_DAYS }),
                            );
                            return;
                        }
                        button.setDisabled(true);
                        const moved = await this.postpone(days);
                        new Notice(t("POSTPONE_DONE", { count: moved, days }));
                        this.close();
                    }),
            )
            .addButton((button) => button.setButtonText(t("CANCEL")).onClick(() => this.close()));
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
