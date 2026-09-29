import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";

/**
 * Settings that only exist in Cardwright. The original plugin never has them, and they must not be overwritten.
 */
const CARDWRIGHT_ONLY_KEYS: ReadonlySet<string> = new Set([
    "leechThreshold",
    "leechAction",
    "dailyLimitsEnabled",
    "newCardsPerDay",
    "reviewsPerDay",
    "reviewLogFolder",
    // M3a: scheduling
    "fsrsLearningSteps",
    "fsrsRelearningSteps",
    "fsrsEnableFuzz",
    "fsrsWeights",
    "answerKeys",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameKind(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b);
    return typeof a === typeof b;
}

/**
 * Merges the settings stored by the original Spaced Repetition plugin (its `data.json`) into Cardwright's.
 * Only settings that Cardwright also has, with a value of the same kind, are copied.
 *
 * @param current - Cardwright's current settings (not modified).
 * @param imported - The parsed content of the original plugin's `data.json`.
 */
export function mergeImportedSettings(
    current: SRSettings,
    imported: unknown,
): { settings: SRSettings; importedKeys: string[] } {
    const settings: SRSettings = { ...current };
    const importedKeys: string[] = [];
    if (!isPlainObject(imported) || !isPlainObject(imported.settings)) {
        return { settings, importedKeys };
    }

    const target = settings as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(imported.settings)) {
        if (!(key in DEFAULT_SETTINGS) || CARDWRIGHT_ONLY_KEYS.has(key)) continue;
        const defaultValue = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
        if (value === undefined || value === null || !sameKind(value, defaultValue)) continue;
        target[key] = Array.isArray(value) ? [...(value as unknown[])] : value;
        importedKeys.push(key);
    }
    return { settings, importedKeys };
}
