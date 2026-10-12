import { App, Notice, Platform, PluginSettingTab, SettingDefinitionItem } from "obsidian";

import { SettingsManager } from "src/data/stored-data";
import { STUDIO_ICON } from "src/icons/studio-icon";
import { errorMessage, reportFailure } from "src/settings/actions";
import { readControl, SettingsEnv, StoredKey, writeControl } from "src/settings/adapters";
import type { SettingsContext } from "src/settings/context";
import { aiGroup } from "src/settings/definitions/ai";
import { cardFormatsGroup } from "src/settings/definitions/card-formats";
import { dataGroup } from "src/settings/definitions/data";
import { displayGroup } from "src/settings/definitions/display";
import { noteReviewGroup } from "src/settings/definitions/note-review";
import { remindersGroup } from "src/settings/definitions/reminders";
import { schedulingGroup, schedulingNotices } from "src/settings/definitions/scheduling";
import { sourcesGroup } from "src/settings/definitions/sources";
import { studyingGroup } from "src/settings/definitions/studying";
import { pluginEffectHost } from "src/settings/effect-host";
import { applyEffects, EffectHost } from "src/settings/effects";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirm-modal";

/**
 * The groups of settings, in the order the tab shows them. Each one is `(ctx) => SettingDefinitionItem[]`.
 */
const GROUPS: ((ctx: SettingsContext) => SettingDefinitionItem[])[] = [
    sourcesGroup,
    studyingGroup,
    schedulingGroup,
    cardFormatsGroup,
    noteReviewGroup,
    displayGroup,
    remindersGroup,
    aiGroup,
    dataGroup,
];

interface Watcher {
    keys: StoredKey[];
    fn: () => void;
}

/** The plugin's settings, built in src/settings. */
export class StudioSettingTab extends PluginSettingTab {
    private readonly env: SettingsEnv = {
        get isMobile() {
            return Platform.isMobile;
        },
    };
    private readonly host: EffectHost;
    private readonly watchers = new Set<Watcher>();
    private readonly ctx: SettingsContext;
    /** Saves wait for the one before them, so a slow save can never land after a newer one. */
    private saving: Promise<unknown> = Promise.resolve();
    /** What was last typed into each control that has a notice, so a notice can tell a change from more of the same. */
    private readonly lastTyped = new Map<string, unknown>();

    constructor(
        app: App,
        readonly plugin: FlashcardStudioPlugin,
        readonly settingsManager: SettingsManager,
    ) {
        super(app, plugin);
        this.icon = STUDIO_ICON;
        this.host = pluginEffectHost(plugin);
        this.ctx = {
            get settings() {
                return settingsManager.settings;
            },
            env: this.env,
            app,
            plugin,
            commit: (keys) => this.commit(keys),
            rebuild: () => this.update(),
            refresh: () => this.refreshDomState(),
            watch: (keys, fn) => this.watch(keys, fn),
            confirm: (title, body, onConfirm) => {
                // The dialog stays open while the action runs and closes when this resolves. A second click on
                // Confirm gets the action already running, so it neither runs it twice nor closes the dialog early.
                let inFlight: Promise<void> | undefined;
                const run = async (): Promise<void> => {
                    try {
                        await onConfirm();
                    } catch (error) {
                        reportFailure(error);
                    }
                };
                const confirmOnce = (): Promise<void> => {
                    inFlight ??= run().finally(() => {
                        inFlight = undefined;
                    });
                    return inFlight;
                };
                new ConfirmationModal(app, title, body, "", confirmOnce).open();
            },
        };
    }

    /** What every group builder is given. */
    context(): SettingsContext {
        return this.ctx;
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return GROUPS.flatMap((group) => group(this.ctx));
    }

    getControlValue(key: string): unknown {
        return readControl(this.settingsManager.settings, key, this.env);
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        // A notice is decided from the value as typed and the settings as they are before it is written.
        const noticeFor = schedulingNotices[key];
        const notice = noticeFor?.(value, this.settingsManager.settings, this.lastTyped.get(key));
        if (noticeFor !== undefined) this.lastTyped.set(key, value);
        const written = writeControl(this.settingsManager.settings, key, value, this.env);
        await this.commit(written);
        if (notice !== undefined) new Notice(notice);
    }

    /**
     * The one path every change takes: run what the keys call for, save, tell the watchers, and redraw when the
     * effects changed other keys. It never rejects: a failing effect or watcher is reported, and the change is saved
     * either way. A failing effect does not stop the others.
     */
    private async commit(keys: StoredKey[]): Promise<void> {
        let changedByEffects: StoredKey[] = [];
        try {
            changedByEffects = applyEffects(
                keys,
                this.settingsManager.settings,
                this.host,
                this.env,
                (effect, error) => {
                    new Notice("Couldn't apply the change: " + errorMessage(error));
                    console.error("Couldn't apply the settings change", effect, error);
                },
            );
        } catch (error) {
            // Not expected, as every effect is caught above; this keeps the save and the watchers safe regardless.
            new Notice("Couldn't apply the change: " + errorMessage(error));
            console.error("Couldn't apply the settings change", error);
        }
        await this.save();

        const touched = new Set<StoredKey>([...keys, ...changedByEffects]);
        for (const watcher of [...this.watchers]) {
            if (!watcher.keys.some((key) => touched.has(key))) continue;
            try {
                watcher.fn();
            } catch (error) {
                console.error("A settings watcher failed", error);
            }
        }
        if (changedByEffects.length > 0) this.update();
    }

    /** Saves after any save already running, and shows a failure instead of swallowing it. */
    private async save(): Promise<void> {
        const run = this.saving.then(() => this.settingsManager.saveOrThrow());
        this.saving = run.catch((): void => undefined);
        try {
            await run;
        } catch (error) {
            new Notice("Couldn't save: " + errorMessage(error));
            console.error("Couldn't save the settings", error);
        }
    }

    private watch(keys: StoredKey[], fn: () => void): () => void {
        const watcher: Watcher = { keys, fn };
        this.watchers.add(watcher);
        return () => this.watchers.delete(watcher);
    }
}
