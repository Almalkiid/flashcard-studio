import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { reviewOpensInTab, SettingsEnv, StoredKey } from "src/settings/adapters";

/** Everything a settings change can make the rest of the plugin do. */
export type Effect =
    | "refreshScheduler"
    | "rebuildScheduler"
    | "mathMacro"
    | "reminders"
    | "statusBar"
    | "startOfDay"
    | "parserDebug"
    | "aiModel"
    | "openInTab"
    | "hotkeys";

/** The order effects run in, whichever keys asked for them. */
const EFFECT_ORDER: readonly Effect[] = [
    "refreshScheduler",
    "rebuildScheduler",
    "mathMacro",
    "reminders",
    "statusBar",
    "startOfDay",
    "parserDebug",
    "aiModel",
    "openInTab",
    "hotkeys",
];

export const EFFECTS_BY_KEY: Partial<Record<StoredKey, Effect[]>> = {
    fsrsDesiredRetention: ["refreshScheduler"],
    maximumInterval: ["refreshScheduler"],
    fsrsLearningSteps: ["refreshScheduler"],
    fsrsRelearningSteps: ["refreshScheduler"],
    fsrsEnableFuzz: ["refreshScheduler"],
    fsrsLoadBalance: ["refreshScheduler"],
    fsrsEasyDays: ["refreshScheduler"],
    fsrsWeights: ["refreshScheduler"],
    algorithm: ["rebuildScheduler"],
    latexClozes: ["mathMacro"],
    enableReviewReminders: ["reminders"],
    reviewReminderIntervalMinutes: ["reminders"],
    reviewReminderCheckOnStartup: ["reminders"],
    showStatusBar: ["statusBar"],
    showCardStatusBarItem: ["statusBar"],
    showNoteStatusBarItem: ["statusBar"],
    showUpdateAvailableStatusBarItem: ["statusBar"],
    startOfDay: ["startOfDay"],
    showParserDebugMessages: ["parserDebug"],
    aiProvider: ["aiModel"],
    openViewInNewTab: ["openInTab"],
    openViewInNewTabMobile: ["openInTab"],
    desktopLayout: ["openInTab"],
    reviewLook: ["openInTab"],
    useCustomHotkeys: ["hotkeys"],
    flashcardAgainText: ["hotkeys"],
    flashcardHardText: ["hotkeys"],
    flashcardGoodText: ["hotkeys"],
    flashcardEasyText: ["hotkeys"],
};

/** What the rest of the plugin does for each effect; `pluginEffectHost` is the real one. */
export interface EffectHost {
    refreshScheduler(): void;
    rebuildScheduler(): void;
    setMathMacro(on: boolean): void;
    restartReminders(): void;
    refreshStatusBar(): void;
    applyStartOfDay(text: string): void;
    setParserDebug(on: boolean): void;
    /** Removes the custom hotkey commands, then adds them again when `on`. */
    setHotkeys(on: boolean): void;
    leaveTabMode(): void;
}

/**
 * One key for each effect that depends on a stored value alone. The settings were replaced as a whole (read again
 * from disk, imported from another plugin), so all of these are redone. `aiModel` and `openInTab` are left out: they
 * change settings in answer to a person's choice, not to values that are already there.
 */
const RELOAD_KEYS: readonly StoredKey[] = [
    "fsrsWeights",
    "algorithm",
    "latexClozes",
    "enableReviewReminders",
    "showStatusBar",
    "startOfDay",
    "showParserDebugMessages",
    "useCustomHotkeys",
];

/** The effects the changed keys call for, each once, in a fixed order. */
export function effectsFor(keys: readonly StoredKey[]): Effect[] {
    const wanted = new Set<Effect>();
    for (const key of keys) for (const effect of EFFECTS_BY_KEY[key] ?? []) wanted.add(effect);
    return EFFECT_ORDER.filter((effect) => wanted.has(effect));
}

/**
 * Runs everything the changed keys call for, each effect on its own: one that throws is handed to `onError` and the
 * others still run. Returns the extra stored keys the effects changed themselves, so the caller can save them and
 * refresh the controls that show them.
 *
 * @param onError - Told which effect failed and why. Without it a failure is thrown at once, as it was before.
 */
export function applyEffects(
    keys: readonly StoredKey[],
    settings: StudioSettings,
    host: EffectHost,
    env: SettingsEnv,
    onError: (effect: Effect, error: unknown) => void = (_effect, error) => {
        throw error;
    },
): StoredKey[] {
    const changed = new Set<StoredKey>();
    let hotkeysApplied = false;

    for (const effect of effectsFor(keys)) {
        try {
            switch (effect) {
                case "refreshScheduler":
                    host.refreshScheduler();
                    break;
                case "rebuildScheduler":
                    host.rebuildScheduler();
                    break;
                case "mathMacro":
                    host.setMathMacro(settings.latexClozes);
                    break;
                case "reminders":
                    host.restartReminders();
                    break;
                case "statusBar":
                    host.refreshStatusBar();
                    break;
                case "startOfDay":
                    host.applyStartOfDay(settings.startOfDay);
                    break;
                case "parserDebug":
                    host.setParserDebug(settings.showParserDebugMessages);
                    break;
                case "aiModel":
                    settings.aiModel =
                        settings.aiProvider === "anthropic" ? DEFAULT_SETTINGS.aiModel : "";
                    changed.add("aiModel");
                    break;
                case "openInTab": {
                    if (reviewOpensInTab(settings, env)) break;
                    host.leaveTabMode();
                    // The hotkeys are the computer's: a phone leaving tab mode must not turn them off for it.
                    if (env.isMobile) break;
                    if (settings.useCustomHotkeys) {
                        settings.useCustomHotkeys = false;
                        changed.add("useCustomHotkeys");
                        host.setHotkeys(false);
                        hotkeysApplied = true;
                    }
                    break;
                }
                case "hotkeys":
                    if (!hotkeysApplied) host.setHotkeys(settings.useCustomHotkeys);
                    break;
            }
        } catch (error) {
            onError(effect, error);
        }
    }
    return [...changed];
}

/** Redoes every effect of the settings after they were replaced as a whole; a failing effect does not stop the rest. */
export function applyReloadedSettings(
    settings: StudioSettings,
    host: EffectHost,
    env: SettingsEnv,
    onError: (effect: Effect, error: unknown) => void = (effect, error) =>
        console.error("Flashcard Studio: couldn't apply the settings", effect, error),
): void {
    applyEffects(RELOAD_KEYS, settings, host, env, onError);
}
