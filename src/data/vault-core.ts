import type { BuriedCards } from "src/data/data-structures/card/buried-cards";
import type { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import { Deck, DeckFilter } from "src/data/decks/deck";
import { TopicPath } from "src/data/decks/topic-path";
import { SettingsUtil, StudioSettings } from "src/data/settings-model";
import type { Note } from "src/note-review/note";
import { NoteFileLoader } from "src/note-review/note-file-loader";
import type { NoteReviewQueue } from "src/note-review/note-review-queue";
import { CardDueDateHistogram, NoteDueDateHistogram } from "src/scheduling/due-histogram";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import type { ReviewResponse } from "src/scheduling/schedule/review-item";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { ActiveScheduler } from "src/scheduling/schedule/scheduler-kind";
import { IVaultNoteLinkFinder, NoteLinkGraph } from "src/scheduling/sm2/note-graph";
import { DateUtil, globalDateProvider } from "src/utils/clock";
import type { TextDirection } from "src/utils/text";

/**
 * What the vault holds, read note by note: the flashcard decks and the notes to review, with the counts and
 * histograms that go with them. A scan is `loadInitialStateOfCore`, `processFile` for each note, `finalizeLoad`.
 */
export class VaultIndex {
    defaultTextDirection!: TextDirection;

    private settings!: StudioSettings;
    private linkInfoFinder!: IVaultNoteLinkFinder;
    private dataChangedHandler!: () => Promise<void>;
    private _buriedCards!: BuriedCards;
    private _noteReviewQueue!: NoteReviewQueue;
    private readonly _dueDateFlashcardHistogram = new CardDueDateHistogram();
    private readonly _dueDateNoteHistogram = new NoteDueDateHistogram();

    private noteLinkGraph!: NoteLinkGraph;
    /** Filled while a scan runs; null before the first one. */
    private fullRoot: Deck | null = null;
    private _reviewableRoot: Deck = new Deck("root", null);
    private _remainingRoot: Deck | null = null;

    constructor(...parts: Parameters<VaultIndex["initUnitTestCore"]>) {
        this.initUnitTestCore(...parts);
    }

    /** The constructor's work. The unit test core runs it again with its own parts. */
    initUnitTestCore(
        postponed: BuriedCards,
        linkFinder: IVaultNoteLinkFinder,
        settings: StudioSettings,
        onDataChanged: () => Promise<void>,
        reviewQueue: NoteReviewQueue,
        textDirection: TextDirection,
    ): void {
        Object.assign(this, {
            _buriedCards: postponed,
            linkInfoFinder: linkFinder,
            settings,
            dataChangedHandler: onDataChanged,
            _noteReviewQueue: reviewQueue,
            defaultTextDirection: textDirection,
        });
        const boundary = DateUtil.strToDayBoundary(settings.startOfDay);
        if (boundary) globalDateProvider.setDayBoundary(boundary);
        else console.warn("Invalid format for start of day", settings.startOfDay);
    }

    // #region -> State

    get noteReviewQueue() {
        return this._noteReviewQueue;
    }

    get buriedCards() {
        return this._buriedCards;
    }

    /** Every card of the last scan, sorted, for the counts and the lists; sessions work on copies of it. */
    get reviewableRoot() {
        return this._reviewableRoot;
    }

    /** The cards a review session can take today; null before the first scan ends. */
    get remainingRoot() {
        return this._remainingRoot;
    }

    get dueDateFlashcardHistogram() {
        return this._dueDateFlashcardHistogram;
    }

    get dueDateNoteHistogram() {
        return this._dueDateNoteHistogram;
    }

    /**
     * The tree a review session takes its cards from: a copy of the scan's trees, so the session can use the cards up
     * without the next one needing a new scan. Cram takes every card, review the ones that are left today.
     */
    sessionTree(mode: FlashcardReviewMode): Deck {
        const source =
            mode === FlashcardReviewMode.Cram ? this._reviewableRoot : this._remainingRoot;
        return source.clone();
    }

    // #endregion

    // #region -> Scanning

    /** Starts a scan. The trees of the last scan stay in place until `finalizeLoad` replaces them. */
    loadInitialStateOfCore(): void {
        this.fullRoot = new Deck("root", null);
        this.noteLinkGraph = new NoteLinkGraph(this.linkInfoFinder);
        this._noteReviewQueue.init();
    }

    async processFile(noteFile: IVaultNoteFile): Promise<void> {
        const { path } = noteFile;
        const noteSchedule = await noteFile.getNoteSchedule();
        this.noteLinkGraph.processLinks(path);

        const tags = noteFile.getAllTagsFromCache();
        const topicPath = TopicPath.getTopicPathOfFile(noteFile, this.settings);
        const cardsWanted =
            topicPath.hasPath && !SettingsUtil.isAnyTagIgnoredForFlashcards(this.settings, tags);
        const note = cardsWanted ? await this.loadNote(noteFile, topicPath) : null;
        note?.appendCardsToDeck(this.fullRoot);

        // A note with flashcards but no schedule of its own teaches it too (its cards' average ease)
        if (noteSchedule || note) {
            ActiveScheduler.getInstance().noteOnLoadedNote(
                path,
                note,
                noteSchedule?.latestEase ?? null,
            );
        }

        const reviewTags = SettingsUtil.filterForNoteReviewTag(this.settings, tags);
        const queueable =
            reviewTags.length > 0 && !SettingsUtil.isAnyTagIgnoredForNotes(this.settings, tags);
        if (queueable) this._noteReviewQueue.addNoteToQueue(noteFile, noteSchedule, reviewTags);
    }

    /** Ends a scan: publishes the trees and the counts, and tells the plugin the data changed. */
    async finalizeLoad(): Promise<void> {
        if (!this.fullRoot) return;
        this.noteLinkGraph.generatePageRanks();
        const sorted = this.fullRoot.clone();
        sorted.sortSubdecksList();
        this._reviewableRoot = sorted;
        await this.refreshQueue();
    }

    /**
     * Works out again what depends on today and on the buried-cards list, from the trees of the last scan, and tells
     * the plugin. This is all a sync needs when no note changed since that scan.
     */
    async refreshQueue(): Promise<void> {
        if (!this.fullRoot) return;
        const all = this._reviewableRoot;
        this._remainingRoot = DeckFilter.filterForRemainingReviewItems(
            this._buriedCards,
            all,
            FlashcardReviewMode.Review,
        );
        this._dueDateFlashcardHistogram.calculateFromRoot(all);
        this.updateNoteCounts();
        await this.dataChangedHandler();
    }

    private updateNoteCounts(): void {
        const queue = this._noteReviewQueue;
        queue.calcDueNotesCount(globalDateProvider.today.valueOf());
        this._dueDateNoteHistogram.calculateFromReviewDecksAndSort(
            queue.reviewDecks,
            this.noteLinkGraph,
        );
    }

    // #endregion

    // #region -> Notes

    /** Reads the cards of a note, and writes the note back if reading it changed it. */
    async loadNote(noteFile: IVaultNoteFile, topicPath: TopicPath): Promise<Note | null> {
        const loader = new NoteFileLoader(this.settings);
        const note = await loader.load(noteFile, this.defaultTextDirection, topicPath);
        if (note?.hasChanged) await note.writeNoteFile(this.settings);
        return note;
    }

    /** Stores the review of a note: its new schedule goes into the note, and the queue and the counts follow. */
    async saveNoteReviewResponse(
        noteFile: IVaultNoteFile,
        response: ReviewResponse,
        settings: StudioSettings,
    ): Promise<void> {
        const algorithm = ActiveScheduler.getInstance();
        const histogram = this._dueDateNoteHistogram;
        const previous = await noteFile.getNoteSchedule();
        const updated: ScheduleState = previous
            ? algorithm.noteCalcUpdatedSchedule(noteFile.path, previous, response, histogram)
            : algorithm.noteCalcNewSchedule(noteFile.path, this.noteLinkGraph, response, histogram);
        await noteFile.setNoteSchedule(updated);

        this._noteReviewQueue.updateScheduleInfo(noteFile, updated);
        this.updateNoteCounts();

        // The cards of the note are put off until tomorrow too
        if (settings.burySiblingCards) {
            const topicPath = TopicPath.getTopicPathOfFile(noteFile, this.settings);
            const note = await this.loadNote(noteFile, topicPath);
            note?.questionList.forEach((question) => this._buriedCards.add(question));
            await this._buriedCards.write();
        }

        await this.dataChangedHandler();
    }

    // #endregion
}
