// The list looks as the suspended cards list does, with its styles
import "src/ui/obsidian-ui-components/modals/suspended-cards-modal.css";
import { Modal, Notice } from "obsidian";

import { t } from "src/lang/translate";
import { keptHistories, type KeptHistory, removeKeptHistories } from "src/scheduling/kept-history";
import { ReviewItemState } from "src/scheduling/schedule/review-item";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirm-modal";
import { openQuestionInNote } from "src/ui/open-question";

/** The question a kept history belongs to, as the suspended list shows a card: its text on one line, cut short. */
function questionLine(item: KeptHistory): string {
    // The question as written, not a card's front (that is rendered HTML): its first line of text, without the cloze
    // marks (`==2;;answer;;hint==`, `{{answer}}`) or any HTML
    const line =
        item.question.questionText.actualQuestion
            .split("\n")
            .map((text) => text.trim())
            .find((text) => text.length > 0 && !/^(`{3,}|~{3,})/.test(text)) ?? "";
    const text = line
        .replace(/<[^>]*>/g, "")
        .replace(/(==|\{\{)(?:\d+;;)?(.*?)(?:;;[^=}]*)?(==|\}\})/g, "$2")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text;
}

/**
 * The history kept for removed card numbers, as Anki's "Empty Cards": each question that keeps one, with those numbers,
 * removed one by one or all after a confirmation, or opened in its note.
 */
export class KeptHistoryModal extends Modal {
    private items: KeptHistory[] = [];
    private countEl!: HTMLElement;
    private allButton!: HTMLButtonElement;
    private listEl!: HTMLElement;

    constructor(private plugin: FlashcardStudioPlugin) {
        super(plugin.app);
    }

    async onOpen(): Promise<void> {
        this.modalEl.addClass("fs-suspended-modal", "fs-kept-history-modal");
        this.setTitle(t("KEPT_HISTORY_TITLE"));
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createDiv({ cls: "fs-suspended-intro", text: t("KEPT_HISTORY_INTRO") });

        const bar = contentEl.createDiv({ cls: "fs-suspended-bar" });
        this.countEl = bar.createSpan({ cls: "fs-suspended-count" });
        this.allButton = bar.createEl("button", { cls: "fs-suspended-all mod-warning" });
        this.allButton.addEventListener("click", () => this.confirmRemoveAll());
        this.listEl = contentEl.createDiv({ cls: "fs-suspended-list" });

        await this.reload();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    /** Reads the vault again, so the list is what the notes say now. */
    private async reload(): Promise<void> {
        await this.plugin.dataManager.sync();
        const cards = this.plugin.dataManager.vaultIndex.reviewableRoot.getFlattenedReviewItemArray(
            ReviewItemState.AnyItem,
            true,
        );
        this.items = keptHistories(cards);
        this.render();
    }

    private cardCount(items: KeptHistory[]): number {
        return items.reduce((sum, item) => sum + item.numbers.length, 0);
    }

    private render(): void {
        const count = this.cardCount(this.items);
        this.countEl.setText(
            count === 1 ? t("KEPT_HISTORY_COUNT_ONE") : t("KEPT_HISTORY_COUNT", { count }),
        );
        this.allButton.setText(t("KEPT_HISTORY_REMOVE_ALL", { count }));
        this.allButton.disabled = count === 0;

        this.listEl.empty();
        if (this.items.length === 0) {
            this.listEl.createDiv({ cls: "fs-suspended-empty", text: t("KEPT_HISTORY_NONE") });
            return;
        }
        for (const item of this.items) this.renderRow(item);
    }

    private renderRow(item: KeptHistory): void {
        const row = this.listEl.createDiv({ cls: "fs-suspended-row" });
        const text = row.createDiv({ cls: "fs-suspended-text" });
        text.createDiv({
            cls: "fs-suspended-front",
            text: t("KEPT_HISTORY_CARDS", {
                numbers: item.numbers.join(", "),
                question: questionLine(item),
            }),
        });
        text.createDiv({ cls: "fs-suspended-note", text: item.question.note.filePath });

        const actions = row.createDiv({ cls: "fs-suspended-actions" });
        const remove = actions.createEl("button", {
            cls: "fs-kept-history-remove mod-warning",
            text: t("KEPT_HISTORY_REMOVE"),
        });
        remove.addEventListener("click", () => this.confirmRemove([item]));
        const open = actions.createEl("button", {
            cls: "fs-suspended-open",
            text: t("SUSPENDED_OPEN_NOTE"),
        });
        open.addEventListener("click", () => {
            this.close();
            void openQuestionInNote(this.app, item.question);
        });
    }

    private confirmRemoveAll(): void {
        if (this.items.length > 0) this.confirmRemove(this.items);
    }

    /** Removing history cannot be undone, so even one card is confirmed first. */
    private confirmRemove(items: KeptHistory[]): void {
        const count = this.cardCount(items);
        new ConfirmationModal(
            this.app,
            count === 1
                ? t("KEPT_HISTORY_CONFIRM_TITLE_ONE")
                : t("KEPT_HISTORY_CONFIRM_TITLE", { count }),
            count === 1
                ? t("KEPT_HISTORY_CONFIRM_DESC_ONE")
                : t("KEPT_HISTORY_CONFIRM_DESC", { count }),
            "",
            async () => {
                const done = await this.remove(items);
                new Notice(
                    done === 1
                        ? t("KEPT_HISTORY_DONE_ONE")
                        : t("KEPT_HISTORY_DONE", { count: done }),
                );
            },
        ).open();
    }

    /** @returns How many cards' history was removed. */
    private async remove(items: KeptHistory[]): Promise<number> {
        try {
            const result = await removeKeptHistories(
                items.map((item) => item.question),
                this.plugin.dataManager.settingsManager.settings,
            );
            if (result.failed > 0) new Notice(t("CHANGE_NOT_SAVED_NOTE_CHANGED"));
            // What a question still keeps after its write: nothing when written, all of it when not
            const left = keptHistories(items.flatMap((item) => item.question.cards));
            return this.cardCount(items) - this.cardCount(left);
        } finally {
            await this.reload();
        }
    }
}
