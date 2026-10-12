import { Notice, TFile } from "obsidian";

import { Sm2NoteStore } from "src/data/data-store/notes/comment-algorithm";
import { NotesDataStore } from "src/data/data-store/notes/notes-store";
import { NoteDataFileModifier } from "src/data/data-store/notes/vault-file-modifier";
import { DataStore, DataStoreAlgorithm } from "src/data/data-store/store";
import { BuriedCards } from "src/data/data-structures/card/buried-cards";
import { VaultNoteFile } from "src/data/data-structures/file/vault-note";
import { TopicPath } from "src/data/decks/topic-path";
import { getDeviceId } from "src/data/review-log/device-id";
import { ObsidianLogAdapter } from "src/data/review-log/obsidian-log-adapter";
import { ReviewLogStore } from "src/data/review-log/review-log-store";
import { SettingsUtil, StudioSettings } from "src/data/settings-model";
import type { PluginDataManager, SettingsManager } from "src/data/stored-data";
import { VaultIndex } from "src/data/vault-core";
import { isInExamsFolder } from "src/exam/exam-results-file";
import { t } from "src/lang/translate";
import type { Note } from "src/note-review/note";
import type { NoteReviewQueue } from "src/note-review/note-review-queue";
import { inPathOrder } from "src/note-review/path-order";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import type { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ActiveScheduler, SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { ObsidianVaultNoteLinkInfoFinder } from "src/scheduling/sm2/note-graph";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import type FlashcardStudioPlugin from "src/studio-plugin";

/**
 * Ties the plugin data, the settings and the vault scan together, and keeps the scan current. `sync()` is what
 * everything calls before it reads decks; it scans the vault only when a note, the settings or the cache changed since
 * the last scan.
 */
export class DataManager {
    private _vaultIndex: VaultIndex | null = null;
    private _deviceId: string | null = null;
    private _syncLock = false;
    private syncInFlight: Promise<void> | null = null;
    /** Set by a call made while a run is going: that run may have missed what the call is about. */
    private syncAgain = false;
    /** What the vault looked like when it was last scanned, as `scanStamp` reads it; null when that scan is stale. */
    private scannedStamp: string | null = null;
    /** Counts the metadata cache's changes, so a scan that read a cache which was still catching up is repeated. */
    private cacheChanges = 0;

    constructor(
        private readonly plugin: FlashcardStudioPlugin,
        public pluginDataManager: PluginDataManager,
        public settingsManager: SettingsManager,
    ) {}

    // #region -> State

    get data() {
        return this.pluginDataManager.pluginData;
    }

    /**
     * The review log for the configured folder. Built on each call so a changed folder setting applies immediately.
     */
    get reviewLog(): ReviewLogStore {
        this._deviceId = this._deviceId ?? getDeviceId(this.plugin.app);
        return new ReviewLogStore(
            new ObsidianLogAdapter(this.plugin.app.vault),
            this.settingsManager.settings.reviewLogFolder,
            this._deviceId,
        );
    }

    get vaultIndex(): VaultIndex {
        if (!this._vaultIndex) throw new Error("Vault index not initialized!!!");
        return this._vaultIndex;
    }

    set vaultIndex(core: VaultIndex) {
        this._vaultIndex = core;
    }

    isDataLoaded = (): boolean => this.pluginDataManager.isLoaded;

    isVaultIndexLoaded = (): boolean => this._vaultIndex !== null;

    /** True while a scan runs, so a screen can avoid acting on half-built decks. */
    get syncLock() {
        return this._syncLock;
    }

    // #endregion

    // #region -> Starting up

    loadData(): void {
        const { settings } = this.settingsManager;
        this.setupDataStoreAndAlgorithmInstances(settings);
    }

    /** Installs the note data store and the scheduler the settings name (SM-2 for any other value). */
    setupDataStoreAndAlgorithmInstances(settings: StudioSettings): void {
        const useFsrs = settings.algorithm === SchedulerKind.FSRS;
        ActiveScheduler.instance = useFsrs
            ? new FsrsCardScheduler(settings)
            : new Sm2Scheduler(settings);
        DataStoreAlgorithm.instance = new Sm2NoteStore(settings);
        DataStore.instance = new NotesDataStore(settings, new NoteDataFileModifier(this.plugin));
    }

    /** Applies changed settings to the scheduler (only FSRS has parameters to refresh). */
    refreshAlgorithmParameters(settings: StudioSettings) {
        const current = ActiveScheduler.getInstance();
        if (current instanceof FsrsCardScheduler) current.updateParameters(settings);
    }

    /**
     * Reads data.json again, after another device or program changed it. The settings object stays the one everyone
     * holds, and so does the bury list the buried cards keep, now holding what the file says.
     */
    async reloadSettings(): Promise<void> {
        await this.pluginDataManager.loadData();
        if (this._vaultIndex === null) return;
        const { list } = this._vaultIndex.buriedCards;
        list.splice(0, list.length, ...this.data.buryList);
        this.data.buryList = list;
    }

    async initVaultIndex(noteReviewQueue: NoteReviewQueue, onChanged: () => Promise<void>) {
        const { settings } = this.settingsManager;
        const { metadataCache } = this.plugin.app;
        const bury = new BuriedCards(this.pluginDataManager, settings, this.data.buryList);
        this._vaultIndex = new VaultIndex(
            bury,
            new ObsidianVaultNoteLinkInfoFinder(metadataCache),
            settings,
            onChanged,
            noteReviewQueue,
            this.plugin.getObsidianRtlSetting(),
        );
        // After the core has set the day boundary, so the list lasts the whole study day
        await bury.clearIfNewDay(this.data);

        this.plugin.registerEvent?.(metadataCache.on("changed", () => this.cacheChanges++));
    }

    // #endregion

    // #region -> Scanning

    /**
     * Brings the decks and the note queue up to date. A call made while a run is going cannot share its result, as the
     * run may have read a note before the change that made the caller ask: the run is repeated once, and all those
     * calls get the result of the repeat. Reads the notes only if something changed since the last scan.
     */
    sync(): Promise<void> {
        if (this.syncInFlight === null) {
            this.syncInFlight = this.runUntilCurrent().finally(() => {
                this.syncInFlight = null;
            });
        } else {
            this.syncAgain = true;
        }
        return this.syncInFlight;
    }

    private async runUntilCurrent(): Promise<void> {
        do {
            this.syncAgain = false;
            await this.runSync();
        } while (this.syncAgain);
    }

    private async runSync(): Promise<void> {
        const core = this.vaultIndex;
        const startedMs = Date.now();
        // A session left open across the day boundary gets its buried siblings back at the next queue load: the list is
        // cleared before the trees are filtered with it
        await core.buriedCards.clearIfNewDay(this.data);
        const direction = this.plugin.getObsidianRtlSetting();
        core.defaultTextDirection = direction;
        await this.loadVault();
        if (this.settingsManager.settings.showSchedulingDebugMessages) {
            console.debug(`Flashcard Studio: ${t("DECKS")}`, core.reviewableRoot);
            console.debug(`Flashcard Studio: sync took ${Date.now() - startedMs}ms`);
        }
    }

    /**
     * Reads every note into the decks and the note queue, one at a time. Does nothing if a scan is already running.
     * When no note, setting or cache entry changed since the last scan, only what depends on today is worked out again.
     */
    async loadVault(): Promise<void> {
        if (this._syncLock) return;
        this._syncLock = true;
        try {
            const notes: TFile[] = inPathOrder(this.plugin.app.vault.getMarkdownFiles());
            await this.waitForMetadataCache(notes);

            const stamp = this.scanStamp(notes);
            const core = this.vaultIndex;
            if (stamp !== null && stamp === this.scannedStamp) {
                await core.refreshQueue();
                return;
            }

            this.scannedStamp = null;
            core.loadInitialStateOfCore();
            const settings = this.settingsManager.settings;
            for (const note of notes) {
                // The review log and the exams are history, not cards; skipping them keeps start-up fast on phones
                if (this.isInReviewLogFolder(note.path) || isInExamsFolder(note.path)) continue;
                if (SettingsUtil.isPathInFoldersToIgnore(settings, note.path)) continue;
                await core.processFile(this.wrapNote(note));
            }
            await core.finalizeLoad();
            this.scannedStamp = stamp;
        } finally {
            this._syncLock = false;
        }
    }

    /**
     * What a scan depends on, as text: every note's path, change time and size, the metadata cache's change count and
     * the settings. Null when a note has no change time to go by, as then nothing says it did not change.
     */
    private scanStamp(notes: TFile[]): string | null {
        if (notes.some((note) => !note.stat)) return null;
        const perNote = notes.map(({ path, stat }) => `${path}|${stat.mtime}|${stat.size}`);
        const header = [String(this.cacheChanges), JSON.stringify(this.settingsManager.settings)];
        return [...header, ...perNote].join("\n");
    }

    /**
     * Waits until Obsidian's metadata cache has an entry for every note, or for at most `timeoutMs`.
     *
     * Right after a note changes (for example when a review writes its schedule), Obsidian briefly has no cached
     * metadata for it. Cards are found through the cached tags, so scanning in that moment dropped the whole note
     * and the review showed "no decks". Waiting once per scan for the cache to resolve avoids that.
     */
    private async waitForMetadataCache(notes: TFile[], timeoutMs: number = 3000): Promise<void> {
        const metadataCache = this.plugin.app.metadataCache;
        if (notes.every((note) => metadataCache.getFileCache(note) !== null)) return;

        await new Promise<void>((done) => {
            const timer = window.setTimeout(() => stop(), timeoutMs);
            const ref = metadataCache.on("resolved", () => stop());
            const stop = () => {
                window.clearTimeout(timer);
                metadataCache.offref(ref);
                done();
            };
        });
    }

    /**
     * Whether a path is inside the review log folder, which holds history rather than cards.
     */
    isInReviewLogFolder(path: string): boolean {
        const folder = this.settingsManager.settings.reviewLogFolder.replace(/\/+$/, "");
        return Boolean(folder) && path.startsWith(`${folder}/`);
    }

    // #endregion

    // #region -> Notes

    /**
     * Reads the cards of one note for a single-note review. An exam's file is a record of the exam, never a note with
     * cards: opening it and reviewing "this note" must not read a card out of its title or its questions, and write a
     * schedule into it.
     */
    async loadNote(file: TFile): Promise<Note | null> {
        if (isInExamsFolder(file.path)) return null;
        const noteFile = this.wrapNote(file);
        const folderPath = TopicPath.getFolderPathFromFilename(
            noteFile,
            this.settingsManager.settings,
        );
        return this.vaultIndex.loadNote(noteFile, folderPath);
    }

    private wrapNote(file: TFile): VaultNoteFile {
        const { vault, metadataCache, fileManager } = this.plugin.app;
        return new VaultNoteFile(vault, metadataCache, fileManager, file);
    }

    /** Stores a review of the note as a note, once it is known to be one that can be reviewed. */
    async saveNoteReviewResponse(file: TFile, response: ReviewResponse): Promise<void> {
        const settings = this.settingsManager.settings;
        if (SettingsUtil.isPathInFoldersToIgnore(settings, file.path)) {
            new Notice(t("NOTE_IN_IGNORED_FOLDER"));
            return;
        }
        const noteFile = this.wrapNote(file);
        const tags = noteFile.getAllTagsFromCache();
        if (SettingsUtil.isAnyTagIgnoredForNotes(settings, tags)) {
            new Notice(t("NOTE_HAS_IGNORED_TAG"));
            return;
        }
        if (!SettingsUtil.isAnyTagANoteReviewTag(settings, tags)) {
            new Notice(t("PLEASE_TAG_NOTE"));
            return;
        }

        await this.vaultIndex.saveNoteReviewResponse(noteFile, response, settings);
        new Notice(t("RESPONSE_RECEIVED"));
        if (settings.autoNextNote) await this.plugin.nextNoteReviewHandler.autoReviewNextNote();
    }

    // #endregion

    async savePluginData(): Promise<void> {
        try {
            await this.pluginDataManager.savePluginData();
        } catch (error) {
            console.warn("Flashcard Studio: could not save the plugin data", error);
        }
    }
}
