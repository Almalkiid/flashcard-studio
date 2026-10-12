import { App, Notice, TFile } from "obsidian";

import type { StudioSettings } from "src/data/settings-model";
import { t } from "src/lang/translate";
import { NoteReviewQueue } from "src/note-review/note-review-queue";
import { ReviewDeckSelectionModal } from "src/ui/obsidian-ui-components/modals/deck-picker-modal";

export class NextNoteReviewHandler {
    private lastDeck: string | null = null;

    constructor(
        private readonly app: App,
        private readonly settings: StudioSettings,
        private readonly queue: NoteReviewQueue,
    ) {}

    get lastSelectedReviewDeck() {
        return this.lastDeck;
    }

    get noteReviewQueue() {
        return this.queue;
    }

    /** Says there is nothing left to review. */
    private static allCaughtUp(): void {
        new Notice(t("ALL_CAUGHT_UP"));
    }

    async autoReviewNextNote(): Promise<void> {
        if (!this.settings.autoNextNote) return;
        const { reviewDecks, reviewDeckNameList } = this.queue;
        const remembered = this.lastDeck !== null && reviewDecks.has(this.lastDeck);
        const deck = remembered ? this.lastDeck : reviewDeckNameList[0];
        if (deck) await this.reviewNextNote(deck);
        else NextNoteReviewHandler.allCaughtUp();
    }

    async reviewNextNoteModal(): Promise<void> {
        const names = this.queue.reviewDeckNameList;
        if (names.length === 0) return NextNoteReviewHandler.allCaughtUp();
        if (names.length === 1) return this.reviewNextNote(names[0]);
        const picker = new ReviewDeckSelectionModal(this.app, names);
        picker.submitCallback = (chosen) => void this.reviewNextNote(chosen);
        picker.open();
    }

    async reviewNextNote(deckName: string): Promise<void> {
        const deck = this.queue.reviewDecks.get(deckName);
        if (!deck) {
            new Notice(t("NO_DECK_EXISTS", { deckName }));
            return;
        }
        this.lastDeck = deckName;
        const next = deck.determineNextNote(this.settings.openRandomNote);
        if (next) await this.openNote(deckName, next.tfile);
        else NextNoteReviewHandler.allCaughtUp();
    }

    async openNote(deckName: string, file: TFile): Promise<void> {
        this.lastDeck = deckName;
        const leaf = this.app.workspace.getLeaf();
        await leaf.openFile(file);
    }
}
