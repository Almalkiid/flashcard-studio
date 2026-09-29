import { DEFAULT_DATA, PluginData } from "src/data/plugin-data";
import { cloneDefaultSettings, SRSettings, upgradeSettings } from "src/data/settings";
import SRPlugin from "src/main";
import { setDebugParser } from "src/parser";
import { SRAlgorithmType } from "src/scheduling/algorithms/base/isr-algorithm";

/**
 * Custom error class for plugin data errors.
 */
export class PluginDataError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PluginDataError";
    }
}

/**
 * Manages the plugin data.
 */
export class PluginDataManager {
    private plugin: SRPlugin;
    private _pluginData: PluginData | null = null;
    private _isFirstRun: boolean = false;

    /** True when the plugin started without saved settings, i.e. it was just installed in this vault. */
    get isFirstRun(): boolean {
        return this._isFirstRun;
    }

    constructor(plugin: SRPlugin) {
        this.plugin = plugin;
    }

    get isLoaded(): boolean {
        return this.pluginData !== null;
    }

    get pluginData(): PluginData {
        if (this._pluginData === null)
            throw new PluginDataError(
                "Cant access the plugin data, as the plugin data is not yet loaded!!",
            );
        return this._pluginData;
    }

    set pluginData(pluginData: PluginData) {
        this._pluginData = pluginData;
    }

    /**
     * Loads the plugin data from the data.json from the plugin's folder.
     */
    async loadData(): Promise<void> {
        const loadedData: PluginData = (await this.plugin.loadData()) as PluginData;
        if (loadedData?.settings) upgradeSettings(loadedData.settings);
        // Copies, so that editing the plugin data never changes the shared defaults (e.g. the bury list array)
        this._pluginData = Object.assign(
            JSON.parse(JSON.stringify(DEFAULT_DATA)) as PluginData,
            loadedData,
        );
        this._pluginData.settings = Object.assign(
            cloneDefaultSettings(),
            this._pluginData.settings,
        );

        // New installs start on FSRS. Existing settings (including ones imported from Spaced Repetition) keep
        // whatever algorithm they chose.
        if (!loadedData?.settings) {
            this._pluginData.settings.algorithm = SRAlgorithmType.FSRS;
        }
        this._isFirstRun = !loadedData?.settings;

        setDebugParser(this._pluginData.settings.showParserDebugMessages);
    }

    /**
     * Saves the plugin data.
     *
     * @returns {Promise<void>} - A promise that resolves when the plugin data is saved.
     * @throws {Error} - Throws an error if the plugin data is not loaded.
     */
    async savePluginData(): Promise<void> {
        if (this.pluginData === null)
            throw new PluginDataError("Cant save plugin data, as the data is not yet loaded!!");
        await this.plugin.saveData(this.pluginData);
    }

    /**
     * Writes the settings to the plugin data.
     *
     * @param {SRSettings} settings - The settings to write.
     * @returns {Promise<void>} - A promise that resolves when the settings are written.
     * @throws {Error} - Throws an error if the plugin data is not loaded.
     */
    public async writeSettings(settings: SRSettings): Promise<void> {
        if (this.pluginData === null)
            throw new PluginDataError(
                "Cant write settings, as the plugin data is not yet loaded!!",
            );
        this.pluginData.settings = settings;
        await this.savePluginData();
    }
}
