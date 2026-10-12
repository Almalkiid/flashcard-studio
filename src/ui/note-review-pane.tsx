import "src/ui/obsidian-ui-components/item-views/review-queue.css";
import { ItemView, Menu, setIcon, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";

import { DataStore } from "src/data/data-store/store";
import type { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import type { StudioSettings } from "src/data/settings-model";
import { STUDIO_ICON } from "src/icons/studio-icon";
import { t } from "src/lang/translate";
import { NextNoteReviewHandler } from "src/note-review/next-note-review-handler";
import { NoteReviewDeck } from "src/note-review/note-review-deck";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import FlashcardStudioPlugin from "src/studio-plugin";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirm-modal";
import { formatDateWithMoment, globalDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

export const REVIEW_QUEUE_VIEW_TYPE = "flashcard-studio-note-queue";

/** The pane keys of the groups that have a fixed meaning; a dated group is keyed by its due instant. */
const NEW_KEY = "New";
const TODAY_KEY = "Today";

const div = (host: HTMLElement, cls: string): HTMLDivElement => host.createDiv(cls);

export class ReviewQueueListView extends ItemView {
    constructor(
        leaf: WorkspaceLeaf,
        private readonly handler: NextNoteReviewHandler,
        private readonly settings: StudioSettings,
        private readonly plugin: FlashcardStudioPlugin,
    ) {
        super(leaf);
        const { workspace, vault } = this.app;
        const redraw = () => this.redraw();
        const forgetDeleted = (gone: TAbstractFile) => {
            this.handler.noteReviewQueue.removeNote(gone.path);
            redraw();
        };
        this.registerEvent(workspace.on("file-open", redraw));
        this.registerEvent(vault.on("rename", redraw));
        this.registerEvent(vault.on("delete", forgetDeleted));
    }

    getViewType(): string {
        return REVIEW_QUEUE_VIEW_TYPE;
    }

    getDisplayText(): string {
        return t("NOTES_REVIEW_QUEUE");
    }

    getIcon(): string {
        return STUDIO_ICON;
    }

    async onOpen(): Promise<void> {
        this.redraw();
    }

    onHeaderMenu(menu: Menu): void {
        const close = () => this.app.workspace.detachLeavesOfType(REVIEW_QUEUE_VIEW_TYPE);
        menu.addItem((entry) => entry.setIcon("cross").setTitle(t("CLOSE")).onClick(close));
    }

    redraw(): void {
        const { contentEl } = this;
        const { reviewDecks: decks } = this.handler.noteReviewQueue;
        contentEl.empty();
        contentEl.addClass("fs-note-review-page");

        const header = div(contentEl, "fs-note-review-header");
        const titleRow = div(header, "fs-note-review-header-title-wrapper");
        setIcon(titleRow.createSpan("fs-note-review-header-title-icon"), "lucide-file-clock");
        titleRow.createSpan({
            text: t("OPEN_NOTE_FOR_REVIEW"),
            cls: "fs-note-review-header-title",
        });
        const hint = decks.size > 0 ? "NOTE_REVIEW_QUEUE_HINT" : "NOTE_REVIEW_QUEUE_EMPTY_HINT";
        div(header, "fs-note-review-header-subtitle-wrapper").createDiv({
            text: t(hint),
            cls: "fs-note-review-header-subtitle",
        });

        const tree = div(
            div(contentEl, "tree-item nav-folder mod-root"),
            "tree-item-children nav-folder-children",
        );
        decks.forEach((deck) => this.renderDeck(tree, deck));
    }

    /** A folder row; the caller fills `children`, then calls `finish` once the open state is final. */
    private folder(parent: HTMLElement, label: string, deck: NoteReviewDeck, key: string) {
        const folder = div(parent, "tree-item nav-folder");
        const self = div(folder, "tree-item-self nav-folder-title is-clickable");
        const icon = div(self, "tree-item-icon collapse-icon nav-folder-collapse-indicator");
        setIcon(icon, "chevron-down");
        self.createDiv({ text: label, cls: "tree-item-inner nav-folder-title-content" });
        const children = div(folder, "tree-item-children nav-folder-children");
        const show = () => {
            const open = deck.activeFolders.has(key);
            for (const el of [folder, icon]) el.toggleClass("is-collapsed", !open);
            children.setCssProps({ display: open ? "" : "none" });
        };
        self.addEventListener("click", () => {
            if (deck.activeFolders.has(key)) deck.activeFolders.delete(key);
            else deck.activeFolders.add(key);
            show();
        });
        return { children, show };
    }

    private renderDeck(parent: HTMLElement, deck: NoteReviewDeck): void {
        const { children, show } = this.folder(parent, deck.deckName, deck, deck.deckName);
        if (deck.newNotes.length)
            this.renderGroup(children, deck, t("NEW"), NEW_KEY, deck.newNotes);

        const today = globalDateProvider.today;
        const scheduled = deck.scheduledNotes;
        for (let start = 0; start < scheduled.length;) {
            const due = scheduled[start].dueUnix;
            let end = start;
            while (end < scheduled.length && scheduled[end].dueUnix === due) end++;
            const days = moment(due).startOf("day").diff(today, "days");
            if (days > this.settings.maxNDaysNotesReviewQueue) break;
            const label =
                days === -1
                    ? t("YESTERDAY")
                    : days === 0
                      ? t("TODAY")
                      : days === 1
                        ? t("TOMORROW")
                        : formatDateWithMoment(
                              due,
                              this.settings.preferredDateFormatForNoteReviewQueue,
                          );
            const notes = scheduled.slice(start, end).map((item) => item.note);
            this.renderGroup(children, deck, label, days === 0 ? TODAY_KEY : `due:${due}`, notes);
            start = end;
        }
        show();
    }

    private renderGroup(
        parent: HTMLElement,
        deck: NoteReviewDeck,
        label: string,
        key: string,
        notes: IVaultNoteFile[],
    ): void {
        const { children, show } = this.folder(parent, label, deck, key);
        const activePath = this.app.workspace.getActiveFile()?.path;
        for (const note of notes) {
            const active = note.path === activePath;
            // The open note's group and deck open, so the note can be seen
            if (active) {
                deck.activeFolders.add(key);
                deck.activeFolders.add(deck.deckName);
            }
            this.renderNote(children, deck, note, active);
        }
        show();
    }

    private renderNote(
        parent: HTMLElement,
        deck: NoteReviewDeck,
        note: IVaultNoteFile,
        active: boolean,
    ): void {
        const row = div(parent, "tree-item nav-file");
        const self = div(
            row,
            ["tree-item-self nav-file-title is-clickable", active && "is-active"]
                .filter(Boolean)
                .join(" "),
        );
        self.createDiv({ text: note.basename, cls: "tree-item-inner nav-file-title-content" });
        self.addEventListener("click", (event) => {
            event.preventDefault();
            void this.handler.openNote(deck.deckName, note.tfile);
        });
        const button = self.createEl("button", {
            attr: { "aria-label": "Review options" },
            cls: "fs-review-context-btn clickable-icon",
        });
        setIcon(button, "ellipsis-vertical");
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.showNoteMenu(event, note.tfile);
        });
    }

    private showNoteMenu(event: MouseEvent, file: TFile): void {
        const { settings } = this;
        const menu = new Menu();
        const answers: [string, ReviewResponse][] = [
            [settings.flashcardEasyText, ReviewResponse.Easy],
            [settings.flashcardGoodText, ReviewResponse.Good],
            [settings.flashcardHardText, ReviewResponse.Hard],
        ];
        for (const [difficulty, response] of answers) {
            const save = (): void =>
                void this.plugin.dataManager.saveNoteReviewResponse(file, response);
            menu.addItem((item) =>
                item
                    .setIcon(STUDIO_ICON)
                    .setTitle(t("REVIEW_DIFFICULTY_FILE_MENU", { difficulty }))
                    .onClick(save),
            );
        }

        if (settings.showDeleteButtonInFileMenu) {
            menu.addSeparator();
            menu.addItem((item) =>
                item
                    .setIcon("trash")
                    .setWarning(true)
                    .setTitle(t("DELETE_NOTE_SCHEDULING_DATA_IN_NOTE"))
                    .onClick(() => this.confirmDeleteSchedulingData(file)),
            );
        }
        menu.showAtMouseEvent(event);
    }

    private confirmDeleteSchedulingData(file: TFile): void {
        const { deleteTagsOnSchedulingDataDeletion: withTags, tagsToReview } = this.settings;
        const wipe = async () => {
            await DataStore.instance.fileModifier.deleteNoteSchedulingDataInNote(
                file,
                withTags,
                tagsToReview,
            );
            await this.plugin.dataManager.sync();
        };
        new ConfirmationModal(
            this.app,
            t("DELETE_NOTE_SCHEDULING_DATA_IN_NOTE"),
            t("CONFIRM_NOTE_SCHEDULING_DATA_IN_NOTE_DELETION"),
            t("NOTE_SCHEDULING_DATA_IN_NOTE_DELETION_IN_PROGRESS"),
            wipe,
        ).open();
    }
}
