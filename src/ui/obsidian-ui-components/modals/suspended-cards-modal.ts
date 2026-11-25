import "src/ui/obsidian-ui-components/modals/suspended-cards-modal.css";
import { Modal, Notice, Setting } from "obsidian";

import { DataStore } from "src/data/data-store/store";
import type { Card } from "src/data/data-structures/card/flashcard";
import { t } from "src/lang/translate";
import { filterSuspended, groupByQuestion, suspendedCards } from "src/scheduling/suspended-cards";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirm-modal";
import { openQuestionInNote } from "src/ui/open-question";

/**
 * Every suspended card of the vault, to find one suspended by accident (#26): filtered by text and deck, put back one by
 * one, all of those shown after a confirmation, or opened in its note.
 */
export class SuspendedCardsModal extends Modal {
    private cards: Card[] = [];
    private query = "";
    private deck = "";
    private countEl!: HTMLElement;
    private allButton!: HTMLButtonElement;
    private listEl!: HTMLElement;

    constructor(private plugin: FlashcardStudioPlugin) {
        super(plugin.app);
    }

    async onOpen(): Promise<void> {
        this.modalEl.addClass("fs-suspended-modal");
        this.setTitle(t("SUSPENDED_CARDS_TITLE"));
        const { contentEl } = this;
        contentEl.empty();
        // The decks offered come from the vault as it is now, not as the last scan left it
        await this.plugin.dataManager.sync();

        new Setting(contentEl)
            .addSearch((search) => {
                search.setPlaceholder(t("SUSPENDED_SEARCH"));
                search.inputEl.addClass("fs-suspended-search");
                search.onChange((value) => {
                    this.query = value;
                    this.render();
                });
            })
            .addDropdown((dropdown) => {
                dropdown.selectEl.addClass("fs-suspended-deck");
                dropdown.addOption("", t("SUSPENDED_ALL_DECKS"));
                for (const path of this.deckPaths()) dropdown.addOption(path, path);
                dropdown.onChange((value) => {
                    this.deck = value;
                    this.render();
                });
            });

        const bar = contentEl.createDiv({ cls: "fs-suspended-bar" });
        this.countEl = bar.createSpan({ cls: "fs-suspended-count" });
        this.allButton = bar.createEl("button", { cls: "fs-suspended-all mod-warning" });
        this.allButton.addEventListener("click", () => this.confirmUnsuspendShown());
        this.listEl = contentEl.createDiv({ cls: "fs-suspended-list" });

        await this.reload();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    /** The decks to filter by: every deck and subdeck with cards, as `Parent/Child` paths. */
    private deckPaths(): string[] {
        return this.plugin.dataManager.vaultIndex.reviewableRoot
            .toDeckArray()
            .filter((deck) => !deck.isRootDeck)
            .map((deck) => deck.getTopicPath().path.join("/"));
    }

    /** Reads the vault again, so the list is what the notes say now. */
    private async reload(): Promise<void> {
        await this.plugin.dataManager.sync();
        this.cards = suspendedCards(this.plugin.dataManager.vaultIndex.reviewableRoot);
        this.render();
    }

    private shown(): Card[] {
        return filterSuspended(this.cards, this.query, this.deck);
    }

    private render(): void {
        const shown = this.shown();
        this.countEl.setText(t("SUSPENDED_COUNT", { count: shown.length }));
        this.allButton.setText(t("SUSPENDED_UNSUSPEND_ALL", { count: shown.length }));
        this.allButton.disabled = shown.length === 0;

        this.listEl.empty();
        if (shown.length === 0) {
            const filtered = this.query.trim() !== "" || this.deck !== "";
            this.listEl.createDiv({
                cls: "fs-suspended-empty",
                text: t(
                    filtered && this.cards.length > 0 ? "SUSPENDED_NONE_MATCH" : "SUSPENDED_NONE",
                ),
            });
            return;
        }
        for (const card of shown) this.renderRow(card);
    }

    private renderRow(card: Card): void {
        const row = this.listEl.createDiv({ cls: "fs-suspended-row" });
        const text = row.createDiv({ cls: "fs-suspended-text" });
        text.createDiv({ cls: "fs-suspended-front", text: card.front.replace(/\s+/g, " ").trim() });
        text.createDiv({ cls: "fs-suspended-note", text: card.question.note.filePath });

        const actions = row.createDiv({ cls: "fs-suspended-actions" });
        const unsuspend = actions.createEl("button", {
            cls: "fs-suspended-unsuspend mod-cta",
            text: t("SUSPENDED_UNSUSPEND"),
        });
        unsuspend.addEventListener("click", () => {
            unsuspend.disabled = true;
            void this.unsuspend([card]);
        });
        const open = actions.createEl("button", {
            cls: "fs-suspended-open",
            text: t("SUSPENDED_OPEN_NOTE"),
        });
        open.addEventListener("click", () => {
            this.close();
            void openQuestionInNote(this.app, card.question);
        });
    }

    private confirmUnsuspendShown(): void {
        const shown = this.shown();
        if (shown.length === 0) return;
        const count = shown.length;
        new ConfirmationModal(
            this.app,
            t("SUSPENDED_CONFIRM_TITLE", { count }),
            t("SUSPENDED_CONFIRM_DESC", { count }),
            "",
            async () => {
                const done = await this.unsuspend(shown);
                new Notice(t("SUSPENDED_DONE", { count: done }));
            },
        ).open();
    }

    /**
     * Unsuspends the cards, writing each question once. A question whose note changed since it was read is left as it
     * is, and said so.
     *
     * @returns How many cards were unsuspended.
     */
    private async unsuspend(cards: Card[]): Promise<number> {
        let done = 0;
        let failed = false;
        for (const [question, group] of groupByQuestion(cards)) {
            for (const card of group) card.meta.suspended = false;
            if (await DataStore.getInstance().writeSchedule(question)) {
                done += group.length;
            } else {
                for (const card of group) card.meta.suspended = true;
                failed = true;
            }
        }
        if (failed) new Notice(t("CHANGE_NOT_SAVED_NOTE_CHANGED"));
        await this.reload();
        return done;
    }
}
