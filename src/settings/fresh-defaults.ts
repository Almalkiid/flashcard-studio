import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import type { StoredKey } from "src/settings/adapters";

/** What a new install starts with: the shipped defaults on FSRS, with Anki's answer keys and fuzz. */
export function freshInstallSettings(): StudioSettings {
    const settings = cloneDefaultSettings();
    settings.algorithm = SchedulerKind.FSRS;
    settings.answerKeys = "anki";
    settings.fsrsEnableFuzz = true;
    settings.fsrsLoadBalance = false;
    settings.fsrsEasyDays = [];
    return settings;
}

/**
 * Puts the fresh-install values into the settings object itself, so every part of the plugin that holds it sees them
 * at once. Keys the defaults do not know are left alone.
 *
 * @returns The keys whose value changed.
 */
export function resetSettingsInPlace(settings: StudioSettings): StoredKey[] {
    const fresh = freshInstallSettings();
    const changed = (Object.keys(fresh) as StoredKey[]).filter(
        (key) => JSON.stringify(settings[key]) !== JSON.stringify(fresh[key]),
    );
    Object.assign(settings, fresh);
    return changed;
}
