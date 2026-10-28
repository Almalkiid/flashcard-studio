import type { AiProviderId } from "src/ai/ai-provider";
import { StorageType } from "src/data/data-store/store";
import { t } from "src/lang/translate";
import type { AnswerKeys } from "src/scheduling/answer-keys";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { pathMatchesPattern } from "src/utils/paths";

/** Which due cards a session shows first. */
export type ReviewOrder = "dueDate" | "mostAtRisk";

export interface StudioSettings {
    /** The address of an OpenAI-compatible server, up to and excluding /chat/completions. */
    aiBaseUrl: string;
    /** The id of the secret in Obsidian's secret storage that holds the API key. Never the key itself. */
    aiKeySecret: string;
    /** The model to ask. The Anthropic default is filled in; the other providers have none until it is chosen. */
    aiModel: string;
    aiProvider: AiProviderId;
    algorithm: SchedulerKind;
    answerKeys: AnswerKeys;
    /** A cloze card is only the line that holds the cloze, not the whole paragraph. */
    atomicClozes: boolean;
    autoNextNote: boolean;
    baseEase: number;
    burySiblingCards: boolean;
    /** Callout types (`> [!type]`) that are cards. An empty list turns callout cards off. */
    calloutCardTypes: string[];
    cardCommentOnSameLine: boolean;
    clozePatterns: string[];
    convertBoldTextToClozes: boolean;
    convertClozePatternsToInputs: boolean;
    convertCurlyBracketsToClozes: boolean;
    convertFoldersToDecks: boolean;
    convertHighlightsToClozes: boolean;
    dailyLimitsEnabled: boolean;
    /** Only one storage type exists. */
    dataStore: StorageType;
    deleteTagsOnSchedulingDataDeletion: boolean;
    /**
     * On a computer, the Studio look opens as a full tab with the desktop interface (a sidebar and a dashboard), whatever
     * `openViewInNewTab` says. Only read on a computer; the phone never has it.
     */
    desktopLayout: boolean;
    /** Legacy: cleared on load. */
    disableFileMenuReviewOptions: boolean | undefined;
    easyBonus: number;
    /** Legacy: cleared on load. */
    editLaterTag: string | undefined;
    enableNoteReviewPaneOnStartup: boolean;
    enableReviewReminders: boolean;
    /** The score, in percent, from which an exam counts as passed. A practice target, not an official pass mark. */
    examPassPercent: number;
    flashcardAgainText: string;
    /** A `PickOrder` name. */
    flashcardCardOrder: string;
    /** A `DeckOrder` name. */
    flashcardDeckOrder: string;
    flashcardEasyText: string;
    flashcardGoodText: string;
    flashcardHardText: string;
    flashcardHeightPercentage: number;
    flashcardHeightPercentageMobile: number;
    flashcardTags: string[];
    flashcardTagsToIgnore: string[];
    flashcardWidthPercentage: number;
    flashcardWidthPercentageMobile: number;
    fsrsDesiredRetention: number;
    /** Sunday (0) through Saturday (6), each given the easy-day weight when FSRS load balancing is on. */
    fsrsEasyDays: number[];
    fsrsEnableFuzz: boolean;
    fsrsLearningSteps: string;
    /** Opt-in: choose a quiet due day from FSRS's fuzz window. */
    fsrsLoadBalance: boolean;
    fsrsRelearningSteps: string;
    fsrsWeights: string;
    /** A typed answer ignores accents ("cafe" matches "café"). */
    ignoreAccentsWhenTyping: boolean;
    initiallyExpandAllSubdecksInTree: boolean;
    lapsesIntervalChange: number;
    /** `\cloze{answer}{hint}` is a cloze form inside `$...$` and `$$...$$` math. */
    latexClozes: boolean;
    /** When nothing else is left, cards whose next step is due within this many minutes are shown now (Anki). */
    learnAheadMinutes: number;
    /** Shown in the home screen greeting; empty for none. */
    learnerName: string;
    leechAction: "tag" | "suspend";
    /** Lapses after which a card is a leech; 0 turns leeches off. */
    leechThreshold: number;
    loadBalance: boolean;
    maximumInterval: number;
    maxLinkFactor: number;
    maxNDaysNotesReviewQueue: number;
    multilineCardEndMarker: string;
    multilineCardSeparator: string;
    /** Empty (the default) means there are no card regions. */
    multilineCardStartMarker: string;
    multilineReversedCardSeparator: string;
    newCardsPerDay: number;
    noteFoldersToIgnore: string[];
    noteTagsToIgnore: string[];
    openRandomNote: boolean;
    openViewInNewTab: boolean;
    openViewInNewTabMobile: boolean;
    preferredDateFormatForNoteReviewQueue: string;
    /** English only ships; kept so older data loads unchanged. */
    preferredLocale: string;
    /** Legacy: converted to the two order keys on load. */
    randomizeCardOrder: boolean | undefined;
    readAnswerAloud: boolean;
    readQuestionAloud: boolean;
    reviewButtonDelay: number;
    reviewLogFolder: string;
    /** "studio" is the refined default review screen; "classic" keeps the original plugin's look. */
    reviewLook: "studio" | "classic";
    /** Which due cards come first within a deck: in the stored order, or those most likely forgotten first. */
    reviewOrder: ReviewOrder;
    reviewReminderAutoOpen: boolean;
    reviewReminderBounceDock: boolean;
    reviewReminderCheckOnStartup: boolean;
    reviewReminderIntervalMinutes: number;
    reviewReminderMessage: string;
    reviewReminderPlaySound: boolean;
    reviewReminderShowNotice: boolean;
    reviewsPerDay: number;
    /** For a storage type that does not exist. */
    scheduleDataVaultLocation: string;
    showCardStatusBarItem: boolean;
    showContextInCards: boolean;
    showDeleteButtonInCardView: boolean;
    showDeleteButtonInFileMenu: boolean;
    showFileMenuReviewOptions: boolean;
    showIntervalInReviewButtons: boolean;
    showNoteStatusBarItem: boolean;
    showParserDebugMessages: boolean;
    /** Legacy: nothing reads it. */
    showRibbonIcon: boolean | undefined;
    showSchedulingDebugMessages: boolean;
    showStatusBar: boolean;
    showUpdateAvailableStatusBarItem: boolean;
    /** The options of a multiple choice card show in a new order each time. */
    shuffleChoices: boolean;
    singleLineCardSeparator: string;
    singleLineReversedCardSeparator: string;
    /** 1 is the voice's normal speed. */
    speechRate: number;
    /** The voiceURI of the voice to read with; empty picks one by language. */
    speechVoice: string;
    /** When the study day starts, as `H:MM:SS`. */
    startOfDay: string;
    tagsToReview: string[];
    /** Type the answer to a card whose answer is short plain text, and fill in cloze blanks in the card. */
    typeAnswers: boolean;
    typedAnswerEvaluation: "deterministic" | "ai-assisted";
    useCalloutsForSchedulingComments: boolean;
    useCustomHotkeys: boolean;
}

export const DEFAULT_SETTINGS: StudioSettings = {
    aiBaseUrl: "",
    aiKeySecret: "",
    aiModel: "claude-sonnet-5-5",
    aiProvider: "anthropic",
    algorithm: SchedulerKind.SM2,
    answerKeys: "original",
    atomicClozes: false,
    autoNextNote: false,
    baseEase: 250,
    burySiblingCards: false,
    calloutCardTypes: ["flashcard", "question", "card"],
    cardCommentOnSameLine: false,
    clozePatterns: ["==[123;;]answer[;;hint]=="],
    convertBoldTextToClozes: false,
    convertClozePatternsToInputs: false,
    convertCurlyBracketsToClozes: false,
    convertFoldersToDecks: false,
    convertHighlightsToClozes: true,
    dailyLimitsEnabled: true,
    dataStore: StorageType.NOTES,
    deleteTagsOnSchedulingDataDeletion: false,
    desktopLayout: true,
    disableFileMenuReviewOptions: undefined,
    easyBonus: 1.3,
    editLaterTag: undefined,
    enableNoteReviewPaneOnStartup: true,
    enableReviewReminders: false,
    examPassPercent: 75,
    flashcardAgainText: t("AGAIN"),
    flashcardCardOrder: "DueFirstRandom",
    flashcardDeckOrder: "PrevDeckComplete_Sequential",
    flashcardEasyText: t("EASY"),
    flashcardGoodText: t("GOOD"),
    flashcardHardText: t("HARD"),
    flashcardHeightPercentage: 60,
    flashcardHeightPercentageMobile: 100,
    flashcardTags: ["#flashcards"],
    flashcardTagsToIgnore: [],
    flashcardWidthPercentage: 60,
    flashcardWidthPercentageMobile: 100,
    fsrsDesiredRetention: 0.9,
    fsrsEasyDays: [],
    // Existing installs keep no fuzz and the original keys; a new install starts with both switched on
    // (see `freshInstallSettings`)
    fsrsEnableFuzz: false,
    fsrsLearningSteps: "1m 10m",
    fsrsLoadBalance: false,
    fsrsRelearningSteps: "10m",
    // Empty means FSRS's default weights
    fsrsWeights: "",
    ignoreAccentsWhenTyping: false,
    initiallyExpandAllSubdecksInTree: true,
    lapsesIntervalChange: 0.5,
    latexClozes: false,
    // Anki's default
    learnAheadMinutes: 20,
    learnerName: "",
    leechAction: "suspend",
    leechThreshold: 8,
    loadBalance: true,
    maximumInterval: 36525,
    maxLinkFactor: 1.0,
    maxNDaysNotesReviewQueue: 365,
    multilineCardEndMarker: "",
    multilineCardSeparator: "?",
    multilineCardStartMarker: "",
    multilineReversedCardSeparator: "??",
    newCardsPerDay: 20,
    noteFoldersToIgnore: ["**/*.excalidraw.md"],
    noteTagsToIgnore: [],
    openRandomNote: false,
    openViewInNewTab: false,
    openViewInNewTabMobile: false,
    preferredDateFormatForNoteReviewQueue: "MMM DD YYYY",
    preferredLocale: "-",
    randomizeCardOrder: undefined,
    readAnswerAloud: false,
    readQuestionAloud: false,
    reviewButtonDelay: 0,
    reviewLogFolder: "Flashcard Studio/Review log",
    reviewLook: "studio",
    reviewOrder: "dueDate",
    reviewReminderAutoOpen: true,
    reviewReminderBounceDock: true,
    reviewReminderCheckOnStartup: false,
    reviewReminderIntervalMinutes: 5,
    reviewReminderMessage: "",
    reviewReminderPlaySound: true,
    reviewReminderShowNotice: true,
    reviewsPerDay: 200,
    scheduleDataVaultLocation: "Spaced Repetition",
    showCardStatusBarItem: true,
    showContextInCards: true,
    showDeleteButtonInCardView: false,
    showDeleteButtonInFileMenu: false,
    showFileMenuReviewOptions: true,
    showIntervalInReviewButtons: true,
    showNoteStatusBarItem: true,
    showParserDebugMessages: false,
    showRibbonIcon: undefined,
    showSchedulingDebugMessages: false,
    showStatusBar: true,
    // Off by default: Obsidian and BRAT already announce updates, so no unprompted network request
    showUpdateAvailableStatusBarItem: false,
    shuffleChoices: true,
    singleLineCardSeparator: "::",
    singleLineReversedCardSeparator: ":::",
    speechRate: 1,
    speechVoice: "",
    startOfDay: "00:00:00",
    tagsToReview: ["#review"],
    typeAnswers: false,
    typedAnswerEvaluation: "deterministic",
    useCalloutsForSchedulingComments: false,
    useCustomHotkeys: false,
};

/**
 * A deep copy of the default settings. Settings that are kept and edited must never be the shared DEFAULT_SETTINGS
 * object, or share its arrays, or later edits would silently change the defaults. Keys whose default is `undefined`
 * are left out.
 */
export function cloneDefaultSettings(): StudioSettings {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as StudioSettings;
}

const CLOZE_FORMS: readonly [flag: keyof StudioSettings, pattern: string][] = [
    ["convertHighlightsToClozes", "==[123;;]answer[;;hint]=="],
    ["convertBoldTextToClozes", "**[123;;]answer[;;hint]**"],
    ["convertCurlyBracketsToClozes", "{{[123;;]answer[;;hint]}}"],
];

const isMissing = (value: unknown): boolean => value === null || value === undefined;

/** Reminder switches that older settings lack. */
const REMINDER_SWITCHES = [
    "enableReviewReminders",
    "reviewReminderCheckOnStartup",
    "reviewReminderMessage",
    "reviewReminderAutoOpen",
    "reviewReminderShowNotice",
    "reviewReminderPlaySound",
    "reviewReminderBounceDock",
] as const;

/**
 * Brings settings read from data.json up to date, in place. There is no version number: every rule looks at the
 * shape of the data, so running it again changes nothing. Values without a rule are not checked.
 */
export function upgradeSettings(settings: StudioSettings): void {
    // Meaning checks start off; any value other than AI-assisted is the local check.
    if (settings.typedAnswerEvaluation !== "ai-assisted") {
        settings.typedAnswerEvaluation = "deterministic";
    }

    // The ribbon icon switch is gone
    if (settings.showRibbonIcon) settings.showRibbonIcon = undefined;

    // One random-order switch became the two order settings
    if (
        !isMissing(settings.randomizeCardOrder) &&
        isMissing(settings.flashcardCardOrder) &&
        isMissing(settings.flashcardDeckOrder)
    ) {
        settings.flashcardCardOrder = settings.randomizeCardOrder
            ? "DueFirstRandom"
            : "DueFirstSequential";
        settings.flashcardDeckOrder = "PrevDeckComplete_Sequential";
        settings.randomizeCardOrder = undefined;
    }

    // Three cloze switches became a list of patterns. Without the list and the switches, the default list applies.
    if (isMissing(settings.clozePatterns)) {
        settings.clozePatterns = CLOZE_FORMS.every(([flag]) => isMissing(settings[flag]))
            ? [...DEFAULT_SETTINGS.clozePatterns]
            : CLOZE_FORMS.filter(([flag]) => settings[flag]).map(([, pattern]) => pattern);
    }

    // The file menu switch was inverted; someone who had turned the items off keeps them off
    if (settings.disableFileMenuReviewOptions !== undefined) {
        if (
            settings.disableFileMenuReviewOptions === true &&
            isMissing(settings.showFileMenuReviewOptions)
        ) {
            settings.showFileMenuReviewOptions = false;
        }
        settings.disableFileMenuReviewOptions = undefined;
    }

    settings.editLaterTag &&= undefined;

    // Values that came out missing or unusable take the default. Arrays are copied so edits cannot reach it.
    const blankLocation = (value: unknown) => typeof value === "string" && value.trim() === "";
    const fixes: [keyof StudioSettings, (value: never) => boolean][] = [
        ["scheduleDataVaultLocation", (v) => isMissing(v) || blankLocation(v)],
        ["fsrsDesiredRetention", (v) => isMissing(v)],
        ["reviewReminderIntervalMinutes", (v: number) => isMissing(v) || v < 1],
        ["multilineCardStartMarker", (v) => typeof v !== "string"],
        ["calloutCardTypes", (v) => !Array.isArray(v)],
        ["atomicClozes", (v) => typeof v !== "boolean"],
        ["latexClozes", (v) => typeof v !== "boolean"],
        ...REMINDER_SWITCHES.map((key): [keyof StudioSettings, (value: never) => boolean] => [
            key,
            (v) => isMissing(v),
        ]),
    ];
    const target = settings as unknown as Record<string, unknown>;
    for (const [key, unusable] of fixes) {
        if (!unusable(settings[key] as never)) continue;
        const fallback = DEFAULT_SETTINGS[key];
        target[key] = Array.isArray(fallback) ? [...fallback] : fallback;
    }

    // These opt-in scheduling features must stay off for settings saved before they existed.
    settings.fsrsLoadBalance = settings.fsrsLoadBalance === true;
    const easyDays = Array.isArray(settings.fsrsEasyDays) ? settings.fsrsEasyDays : [];
    const validDays = new Set(
        easyDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    );
    settings.fsrsEasyDays = Array.from(validDays).sort((x, y) => x - y);
}

/** Questions about the tag and folder lists of the settings. */
export class SettingsUtil {
    /** Whether `subTag` is `tag` or below it: `#a` holds `#a` and `#a/b`, not `#ab`. A trailing `/` in `tag` is ignored. */
    static isSubTagContainedInTag(tag: string, subTag: string): boolean {
        const root = tag.replace(/\/+$/, "");
        return subTag === root || subTag.startsWith(`${root}/`);
    }

    /** Whether the tag is in the list or below one of its tags (only equal to one, when `exactMatch`). */
    static isTagInList(list: string[], tag: string, exactMatch: boolean = false): boolean {
        const covers = exactMatch
            ? (entry: string) => entry === tag
            : (entry: string) => SettingsUtil.isSubTagContainedInTag(entry, tag);
        return list.some(covers);
    }

    static isFlashcardTag(settings: StudioSettings, tag: string): boolean {
        return SettingsUtil.isTagInList(settings.flashcardTags, tag);
    }

    static isAnyTagIgnoredForFlashcards(settings: StudioSettings, tags: string[]): boolean {
        const ignored = settings.flashcardTagsToIgnore;
        return tags.some((tag) => SettingsUtil.isTagInList(ignored, tag));
    }

    static isAnyTagIgnoredForNotes(settings: StudioSettings, tags: string[]): boolean {
        return SettingsUtil.anyTagInLowercasedList(settings.noteTagsToIgnore, tags);
    }

    static isAnyTagANoteReviewTag(settings: StudioSettings, tags: string[]): boolean {
        return SettingsUtil.anyTagInLowercasedList(settings.tagsToReview, tags);
    }

    /** Whether some tag is in (or below a tag of) the list, compared without regard to case. */
    private static anyTagInLowercasedList(list: string[], tags: string[]): boolean {
        const lowered = list.map((entry) => entry.toLowerCase());
        return tags.some((tag) => SettingsUtil.isTagInList(lowered, tag.toLowerCase()));
    }

    /** The review tags of the settings that some tag is, or is below, in the settings' order and each once. */
    static filterForNoteReviewTag(settings: StudioSettings, tags: string[]): string[] {
        const lowered = tags.map((tag) => tag.toLowerCase());
        const matched = settings.tagsToReview.filter((reviewTag) => {
            const root = reviewTag.toLowerCase();
            return lowered.some((tag) => SettingsUtil.isSubTagContainedInTag(root, tag));
        });
        return Array.from(new Set(matched));
    }

    /** Whether the path matches an entry of the folders to ignore (a glob, or the start of the path). */
    static isPathInFoldersToIgnore(settings: StudioSettings, path: string): boolean {
        return settings.noteFoldersToIgnore.some((entry) => pathMatchesPattern(path, entry));
    }
}
