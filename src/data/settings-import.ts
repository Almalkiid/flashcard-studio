import { CLOZE_FORMS, DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { normalizeStartOfDay, startOfDayError, wholeNumberError } from "src/settings/validators";

/**
 * Settings that only exist in Flashcard Studio. The original plugin never has them, and they must not be overwritten.
 */
const FLASHCARD_STUDIO_ONLY_KEYS: ReadonlySet<string> = new Set([
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
    "learnAheadMinutes",
    "answerKeys",
    // Study modes
    "typeAnswers",
    "typedAnswerEvaluation",
    "ignoreAccentsWhenTyping",
    "shuffleChoices",
    "readQuestionAloud",
    "readAnswerAloud",
    "speechVoice",
    "speechRate",
    // Exams
    "examPassPercent",
    // The Studio look
    "reviewLook",
    "desktopLayout",
    "learnerName",
    // AI-generated cards
    "aiProvider",
    "aiModel",
    "aiBaseUrl",
    "aiKeySecret",
]);

/** The rules the settings screen holds a value to: an imported value that breaks one is left out. */
const IMPORT_CHECKS: Partial<Record<keyof StudioSettings, (value: unknown) => string | undefined>> =
    {
        baseEase: (value) => wholeNumberError(value as number, 130, 1000),
        maximumInterval: (value) => wholeNumberError(value as number, 1, 36525),
        maxNDaysNotesReviewQueue: (value) => wholeNumberError(value as number, 1, 36500),
        reviewReminderIntervalMinutes: (value) => wholeNumberError(value as number, 1, 1440),
        startOfDay: (value) => startOfDayError(value as string),
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameKind(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b);
    return typeof a === typeof b;
}

const has = (settings: Record<string, unknown>, key: string): boolean =>
    settings[key] !== undefined && settings[key] !== null;

/**
 * A copy of the original plugin's settings with the ones Flashcard Studio renamed or replaced written the current way,
 * as `upgradeSettings` does. Its rules can't do this after the merge: the current settings already have every new key.
 */
function withCurrentNames(legacy: Record<string, unknown>): Record<string, unknown> {
    const settings = { ...legacy };
    // The file menu switch was inverted
    if (
        typeof settings.disableFileMenuReviewOptions === "boolean" &&
        !has(settings, "showFileMenuReviewOptions")
    ) {
        settings.showFileMenuReviewOptions = !settings.disableFileMenuReviewOptions;
    }
    // One random-order switch became the two order settings
    if (
        typeof settings.randomizeCardOrder === "boolean" &&
        !has(settings, "flashcardCardOrder") &&
        !has(settings, "flashcardDeckOrder")
    ) {
        settings.flashcardCardOrder = settings.randomizeCardOrder
            ? "DueFirstRandom"
            : "DueFirstSequential";
        settings.flashcardDeckOrder = "PrevDeckComplete_Sequential";
    }
    // Three cloze switches became a list of patterns
    if (!has(settings, "clozePatterns") && CLOZE_FORMS.some(([flag]) => has(settings, flag))) {
        settings.clozePatterns = CLOZE_FORMS.filter(([flag]) => settings[flag] === true).map(
            ([, pattern]) => pattern,
        );
    }
    return settings;
}

/**
 * Merges the settings stored by the original Spaced Repetition plugin (its `data.json`) into Flashcard Studio's.
 * Only settings that Flashcard Studio also has, with a value of the same kind, are copied. A setting Flashcard Studio
 * renamed or replaced is copied under its current name.
 *
 * @param current - Flashcard Studio's current settings (not modified).
 * @param imported - The parsed content of the original plugin's `data.json`.
 */
export function mergeImportedSettings(
    current: StudioSettings,
    imported: unknown,
): { settings: StudioSettings; importedKeys: string[] } {
    const settings: StudioSettings = { ...current };
    const importedKeys: string[] = [];
    if (!isPlainObject(imported) || !isPlainObject(imported.settings)) {
        return { settings, importedKeys };
    }

    const target = settings as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(withCurrentNames(imported.settings))) {
        if (!(key in DEFAULT_SETTINGS) || FLASHCARD_STUDIO_ONLY_KEYS.has(key)) continue;
        const defaultValue = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
        if (value === undefined || value === null || !sameKind(value, defaultValue)) continue;
        if (IMPORT_CHECKS[key as keyof StudioSettings]?.(value) !== undefined) continue;
        const kept = key === "startOfDay" ? normalizeStartOfDay(value as string) : value;
        target[key] = Array.isArray(kept) ? [...(kept as unknown[])] : kept;
        importedKeys.push(key);
    }
    return { settings, importedKeys };
}
