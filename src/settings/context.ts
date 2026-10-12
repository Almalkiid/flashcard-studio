import type { App } from "obsidian";

import type { StudioSettings } from "src/data/settings-model";
import type { SettingsEnv, StoredKey } from "src/settings/adapters";
import type FlashcardStudioPlugin from "src/studio-plugin";

/** What every settings group builder gets: the settings, and the ways to save, redraw and ask. */
export interface SettingsContext {
    /** The live settings object. Read it inside callbacks, never at build time. */
    readonly settings: StudioSettings;
    readonly env: SettingsEnv;
    readonly app: App;
    readonly plugin: FlashcardStudioPlugin;
    /** Run effects for keys a render/action callback changed, save once, rebuild if other keys changed. */
    commit(keys: StoredKey[]): Promise<void>;
    /** Re-run getSettingDefinitions (rows added/removed, or values changed by code). */
    rebuild(): void;
    /** Re-evaluate visible/disabled predicates only. */
    refresh(): void;
    /** Call `fn` after any of `keys` changes; returns the unsubscribe function (use it as a render cleanup). */
    watch(keys: StoredKey[], fn: () => void): () => void;
    /** Ask before doing something that changes notes or many settings. */
    confirm(title: string, body: string, onConfirm: () => Promise<void> | void): void;
}
