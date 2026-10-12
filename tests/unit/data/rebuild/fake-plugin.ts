import type { TFile } from "obsidian";

import { DataManager } from "src/data/data-hub";
import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import { DEFAULT_DATA, PluginData, PluginDataManager, SettingsManager } from "src/data/stored-data";
import { NoteReviewQueue } from "src/note-review/note-review-queue";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { TextDirection } from "src/utils/text";

import { FakeVault } from "../../scheduling/sm2/fake-vault";

type Handler = (...args: unknown[]) => void;

/**
 * A plugin over a fake vault: enough of Obsidian's app, files with a change time and size, and a metadata cache that
 * serves events, for the data manager to scan.
 */
export class FakePlugin {
    readonly fake: FakeVault;
    readonly settings: StudioSettings;
    readonly data: PluginData;
    readonly handlers = new Map<string, Handler[]>();
    readonly files: TFile[];
    private clock = 1_000;

    constructor(files: Record<string, string>, settings: Partial<StudioSettings> = {}) {
        this.fake = new FakeVault(files);
        this.settings = { ...cloneDefaultSettings(), ...settings };
        this.data = { ...DEFAULT_DATA, settings: this.settings, buryList: [] };
        this.files = Object.keys(files).map((path) => this.fake.tfileOf(path));
        for (const file of this.files) this.touch(file.path);
    }

    /** Marks a file as changed, as Obsidian does when it is written. */
    touch(path: string): void {
        const file = this.fake.tfileOf(path);
        const size = this.fake.texts.get(path)?.length ?? 0;
        file.stat = { ctime: 0, mtime: ++this.clock, size };
    }

    /** Changes a note's text the way an edit does: the text, the change time and the size. */
    edit(path: string, text: string): void {
        this.fake.texts.set(path, text);
        this.touch(path);
    }

    emit(event: string, ...args: unknown[]): void {
        for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }

    /** Files the metadata cache has no entry for yet. */
    readonly uncached = new Set<string>();

    /** Adds a note to the vault. */
    add(path: string, text: string): void {
        this.fake.texts.set(path, text);
        const file = this.fake.tfileOf(path);
        if (!this.files.includes(file)) this.files.push(file);
        this.touch(path);
    }

    /** Takes a note out of the vault. */
    remove(path: string): void {
        this.fake.texts.delete(path);
    }

    readonly metadataCache = new Proxy(
        {},
        {
            get: (_target, key: string) => {
                if (key === "on") {
                    return (event: string, handler: Handler) => {
                        this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
                        return { event, handler };
                    };
                }
                if (key === "offref") {
                    return (ref: { event: string; handler: Handler }) => {
                        const rest = (this.handlers.get(ref.event) ?? []).filter(
                            (h) => h !== ref.handler,
                        );
                        this.handlers.set(ref.event, rest);
                    };
                }
                if (key === "getFileCache") {
                    return (file: TFile) =>
                        this.uncached.has(file.path)
                            ? null
                            : this.fake.metadataCache.getFileCache(file);
                }
                return (this.fake.metadataCache as unknown as Record<string, unknown>)[key];
            },
        },
    );

    readonly registered: unknown[] = [];

    asPlugin(): FlashcardStudioPlugin {
        const vault = {
            ...this.fake.vault,
            getMarkdownFiles: () => this.files.filter((file) => this.fake.texts.has(file.path)),
        };
        return {
            app: { vault, metadataCache: this.metadataCache, fileManager: this.fake.fileManager },
            registerEvent: (ref: unknown) => this.registered.push(ref),
            getObsidianRtlSetting: () => TextDirection.Ltr,
            nextNoteReviewHandler: { autoReviewNextNote: () => Promise.resolve() },
            saveData: () => Promise.resolve(),
        } as unknown as FlashcardStudioPlugin;
    }

    /** A data manager over this plugin with its core started, as `onload` leaves it. */
    async startManager(
        onChanged: () => Promise<void> = () => Promise.resolve(),
    ): Promise<{ manager: DataManager; queue: NoteReviewQueue }> {
        const plugin = this.asPlugin();
        const pluginDataManager = { pluginData: this.data, savePluginData: jest.fn() };
        const settingsManager = new SettingsManager(this.settings, () => Promise.resolve());
        const manager = new DataManager(
            plugin,
            pluginDataManager as unknown as PluginDataManager,
            settingsManager,
        );
        manager.loadData();
        const queue = new NoteReviewQueue();
        await manager.initVaultIndex(queue, onChanged);
        return { manager, queue };
    }
}
