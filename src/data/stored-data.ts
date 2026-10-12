import { setDebugParser } from "src/cards/parse";
import {
    cloneDefaultSettings,
    DEFAULT_SETTINGS,
    StudioSettings,
    upgradeSettings,
} from "src/data/settings-model";
import { migrateExamDrafts } from "src/exam/exam-draft-store";
import { freshInstallSettings } from "src/settings/fresh-defaults";
import type FlashcardStudioPlugin from "src/studio-plugin";

/**
 * Custom study's "increase today's limit": extra new cards and reviews allowed on one day. It only counts while
 * `date` (`YYYY-MM-DD`, after the day boundary) is today, so it resets by itself the next day.
 */
export interface LimitOverride {
    date: string;
    extraNew: number;
    extraReviews: number;
}

/** Everything kept in the plugin's data.json. */
export interface PluginData {
    /** Whether the first-run welcome guide has been shown. */
    welcomeShown?: boolean;
    limitOverride: LimitOverride;
    /** The slots are never filled (see `DEFAULT_DATA`), so what a filled one would hold is not typed. */
    scheduleData: Record<string, unknown>;
    /** Never read; kept so the file keeps its shape. */
    historyDeck: string | null;
    /** Hashes of the questions buried until the next study day. */
    buryList: string[];
    /** The study day the bury list belongs to, `YYYY-MM-DD`; empty before the first one. */
    buryDate: string;
    settings: StudioSettings;
}

export const DEFAULT_DATA: PluginData = {
    limitOverride: { date: "", extraNew: 0, extraReviews: 0 },
    scheduleData: { version: 1, noteSchedules: {}, cardSchedules: {} },
    historyDeck: null,
    buryList: [],
    buryDate: "",
    settings: DEFAULT_SETTINGS,
};

export class PluginDataError extends Error {}

type Dict = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Dict =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** Makes `target` hold exactly what `source` holds, without replacing the object others point at. */
export function replaceContents<T extends object>(target: T, source: T): void {
    if (target === source) return;
    Object.keys(target).forEach((key) => delete (target as Dict)[key]);
    Object.assign(target, source);
}

/**
 * The saved settings laid over the defaults. A saved value wins, except `null`, which says nothing and leaves the
 * default; keys the defaults do not know are kept.
 */
function mergeSettings(saved: Dict): StudioSettings {
    const merged = cloneDefaultSettings() as unknown as Dict;
    const kept = Object.entries(saved).filter(
        ([key, value]) => value !== null || merged[key] === undefined,
    );
    return Object.assign(merged, Object.fromEntries(kept)) as unknown as StudioSettings;
}

/** Loads and saves data.json, with the rules for old and partial files. */
export class PluginDataManager {
    private _pluginData: PluginData | null = null;
    private _isFirstRun = false;

    constructor(private readonly plugin: FlashcardStudioPlugin) {}

    /** True when the plugin started without saved settings, i.e. it was just installed in this vault. */
    get isFirstRun(): boolean {
        return this._isFirstRun;
    }

    get isLoaded(): boolean {
        return Boolean(this._pluginData);
    }

    get pluginData(): PluginData {
        if (!this._pluginData) {
            const reason = "Cant access the plugin data, as the plugin data is not yet loaded!!";
            throw new PluginDataError(reason);
        }
        return this._pluginData;
    }

    async loadData(): Promise<void> {
        const loaded: unknown = await this.plugin.loadData();
        const saved: Dict = isPlainObject(loaded) ? loaded : {};
        const savedSettings = isPlainObject(saved.settings) ? saved.settings : null;
        if (savedSettings) upgradeSettings(savedSettings as unknown as StudioSettings);

        // Copies, so that editing the plugin data never changes the shared defaults (e.g. the bury list array)
        const data = JSON.parse(JSON.stringify(DEFAULT_DATA)) as PluginData & Dict;
        for (const [key, value] of Object.entries(saved)) {
            const fallback = data[key];
            // A saved null says nothing, so the default stands
            if (value === null && fallback !== undefined) continue;
            // Nested records (the limit override) fill their missing fields from the defaults
            data[key] =
                isPlainObject(fallback) && isPlainObject(value) && key !== "settings"
                    ? { ...fallback, ...value }
                    : value;
        }
        data.settings = savedSettings
            ? mergeSettings(savedSettings)
            : // New installs start on FSRS with Anki's keys and fuzz. Existing settings (including ones imported from
              // Spaced Repetition) keep whatever algorithm they chose.
              freshInstallSettings();
        // Loading again keeps the settings object everyone holds, with the loaded values in it
        if (this._pluginData !== null) {
            replaceContents(this._pluginData.settings, data.settings);
            data.settings = this._pluginData.settings;
        }
        this._pluginData = data;
        this._isFirstRun = savedSettings === null;

        setDebugParser(data.settings.showParserDebugMessages);
        await this.moveExamDrafts(loaded);
    }

    /**
     * Older builds kept the drafts of unfinished exams in the plugin data. They are files now, so they are written
     * out and the data is saved once without them. When they cannot all be written they stay where they are, and the
     * next start tries again.
     */
    private async moveExamDrafts(loaded: unknown): Promise<void> {
        if (typeof loaded !== "object" || loaded === null || !("examDrafts" in loaded)) return;
        if (!(await migrateExamDrafts(this.plugin, loaded.examDrafts))) return;
        delete (this.pluginData as unknown as Dict).examDrafts;
        await this.savePluginData();
    }

    async savePluginData(): Promise<void> {
        await this.plugin.saveData(this.pluginData);
    }

    /**
     * Saves the settings. Everything holds the settings object it was given at start, so settings that arrive as
     * another object are copied into that one instead of replacing it.
     */
    async writeSettings(settings: StudioSettings): Promise<void> {
        replaceContents(this.pluginData.settings, settings);
        await this.savePluginData();
    }
}

/** Holds the settings object everyone shares, and saves it. */
export class SettingsManager {
    constructor(
        private readonly _settings: StudioSettings,
        private readonly writeSettings: (settings: StudioSettings) => Promise<void>,
    ) {}

    /** The same object for the life of the plugin, so what was read from it earlier is never stale. */
    get settings(): StudioSettings {
        return this._settings;
    }

    /** Saves the settings; a failure is only logged. Settings given as another object are copied into the shared one. */
    async saveSettings(settings: StudioSettings): Promise<void> {
        replaceContents(this._settings, settings);
        try {
            await this.saveOrThrow();
        } catch (error) {
            console.warn("Flashcard Studio: could not save the settings", error);
        }
    }

    save(): Promise<void> {
        return this.saveSettings(this._settings);
    }

    /** Saves the settings and lets a failure through, for callers that tell the user. */
    saveOrThrow(): Promise<void> {
        return this.writeSettings(this._settings);
    }
}
