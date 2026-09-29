import { TFile } from "obsidian";

import { OsrCore } from "src/data/core";
import { Deck, DeckTreeFilter } from "src/data/data-structures/deck/deck";
import {
    DeckOrder,
    DeckTreeIterator,
    IDeckTreeIterator,
    IIteratorOrder,
    RepItemOrder,
} from "src/data/data-structures/deck/deck-tree-iterator";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { SRSettings } from "src/data/settings";
import SRPlugin from "src/main";
import { Note } from "src/note/note";
import { SRAlgorithm } from "src/scheduling/algorithms/base/sr-algorithm";
import { countToday, DailyLimits, monthsCovering } from "src/scheduling/daily-limits";
import {
    FlashcardReviewMode,
    FlashcardReviewSequencer,
    IFlashcardReviewSequencer,
    UndoRecord,
} from "src/scheduling/flashcard-review-sequencer";
import { UndoHistory } from "src/scheduling/undo-history";
import { globalDateProvider } from "src/utils/dates";

export class ReviewQueueLoader {
    private plugin: SRPlugin;
    private osrCore: OsrCore;
    private singleNote: TFile | null = null;
    private reviewMode: FlashcardReviewMode;

    constructor(
        plugin: SRPlugin,
        osrCore: OsrCore,
        singleNote: TFile | null,
        reviewMode: FlashcardReviewMode,
    ) {
        this.osrCore = osrCore;
        this.singleNote = singleNote;
        this.reviewMode = reviewMode;
        this.plugin = plugin;
    }

    public getSingleNote(): TFile | null {
        return this.singleNote;
    }

    public getReviewMode(): FlashcardReviewMode {
        return this.reviewMode;
    }

    setReviewMode(reviewMode: FlashcardReviewMode) {
        this.reviewMode = reviewMode;
    }

    /**
     * @param undoHistory - Answers that can still be undone, shared across the queues of one review screen.
     */
    public async loadReviewQueue(
        undoHistory?: UndoHistory<UndoRecord>,
    ): Promise<IFlashcardReviewSequencer> {
        if (this.plugin === null || this.plugin.dataManager.osrCore === null)
            throw new Error("SR plugin or OSR app core not initialized!!!");

        // Waits for a sync already in progress, so the queue is never built from a half-loaded vault
        await this.plugin.dataManager.sync();

        let deckTree: Deck;
        let remainingDeckTree: Deck;

        if (this.singleNote) {
            const singleNoteDeckData = await this.getPreparedDecksForSingleNoteReview(
                this.singleNote,
                this.reviewMode,
            );

            deckTree = singleNoteDeckData.deckTree;
            remainingDeckTree = singleNoteDeckData.remainingDeckTree;
        } else {
            deckTree = this.osrCore.reviewableDeckTree;
            remainingDeckTree =
                this.reviewMode === FlashcardReviewMode.Cram
                    ? this.osrCore.reviewableDeckTree
                    : this.osrCore.remainingDeckTree;
        }

        const dailyLimits: DailyLimits | null =
            this.reviewMode === FlashcardReviewMode.Review ? await this.loadDailyLimits() : null;

        const reviewSequencerData = this.getPreparedReviewSequencer(
            deckTree,
            remainingDeckTree,
            this.reviewMode,
            dailyLimits,
            undoHistory,
        );

        return reviewSequencerData.reviewSequencer;
    }

    /**
     * Today's new and review allowance, from the review logs of every device.
     */
    private async loadDailyLimits(): Promise<DailyLimits> {
        const settings: SRSettings = this.plugin.dataManager.data.settings;
        const dayStartMs: number = globalDateProvider.today.valueOf();
        const nowMs: number = globalDateProvider.now.valueOf();
        let entries: ReviewLogEntry[] = [];
        try {
            entries = await this.plugin.dataManager.reviewLog.readMonths(
                monthsCovering(dayStartMs, nowMs),
            );
        } catch (error) {
            console.error("Cardwright: could not read the review log for daily limits", error);
        }
        return new DailyLimits(settings, countToday(entries, dayStartMs));
    }

    public getPreparedReviewSequencer(
        fullDeckTree: Deck,
        remainingDeckTree: Deck,
        reviewMode: FlashcardReviewMode,
        dailyLimits: DailyLimits | null = null,
        undoHistory: UndoHistory<UndoRecord> = new UndoHistory<UndoRecord>(),
    ): { reviewSequencer: IFlashcardReviewSequencer; mode: FlashcardReviewMode } {
        const deckIterator: IDeckTreeIterator = this.createDeckTreeIterator(
            this.plugin.dataManager.data.settings,
        );

        const reviewSequencer: IFlashcardReviewSequencer = new FlashcardReviewSequencer(
            reviewMode,
            deckIterator,
            this.plugin.dataManager.data.settings,
            SRAlgorithm.getInstance(),
            this.plugin.dataManager.osrCore.questionPostponementList,
            this.plugin.dataManager.osrCore.dueDateFlashcardHistogram,
            this.plugin.dataManager.reviewLog,
            dailyLimits,
            undoHistory,
        );

        reviewSequencer.setDeckTree(fullDeckTree, remainingDeckTree);
        return { reviewSequencer, mode: reviewMode };
    }

    public async getPreparedDecksForSingleNoteReview(
        file: TFile,
        mode: FlashcardReviewMode,
    ): Promise<{ deckTree: Deck; remainingDeckTree: Deck; mode: FlashcardReviewMode }> {
        const note: Note | null = await this.plugin.dataManager.loadNote(file);

        const deckTree = new Deck("root", null);
        if (note) {
            note.appendCardsToDeck(deckTree);
        }
        const remainingDeckTree = DeckTreeFilter.filterForRemainingRepItems(
            this.plugin.dataManager.osrCore.questionPostponementList,
            deckTree,
            mode,
        );

        return { deckTree, remainingDeckTree, mode };
    }

    private createDeckTreeIterator(settings: SRSettings): IDeckTreeIterator {
        let cardOrder: RepItemOrder =
            RepItemOrder[settings.flashcardCardOrder as keyof typeof RepItemOrder];
        if (cardOrder === undefined) cardOrder = RepItemOrder.DueFirstSequential;
        let deckOrder: DeckOrder = DeckOrder[settings.flashcardDeckOrder as keyof typeof DeckOrder];
        if (deckOrder === undefined) deckOrder = DeckOrder.PrevDeckComplete_Sequential;

        const iteratorOrder: IIteratorOrder = {
            deckOrder,
            repItemOrder: cardOrder,
        };
        return new DeckTreeIterator(iteratorOrder, null);
    }
}
