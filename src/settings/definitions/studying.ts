import type {
    SettingDefinition,
    SettingDefinitionItem,
    SettingDefinitionPage,
    SettingGroupItem,
} from "obsidian";

import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { t } from "src/lang/translate";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import type { SettingsContext } from "src/settings/context";
import { bindKeys, restoreDefaultsButton } from "src/settings/definitions/helpers";
import {
    nonEmptyError,
    typedAnswerEvaluationError,
    wholeNumberError,
} from "src/settings/validators";
import { speechAvailable, VoiceWatcher } from "src/ui/speech";

const LABEL_KEYS = [
    "flashcardAgainText",
    "flashcardHardText",
    "flashcardGoodText",
    "flashcardEasyText",
] as const;
type SettingLabelKey = (typeof LABEL_KEYS)[number];

/** The button wording: one text row per answer button, with a header button to put them all back. */
function answerLabelsPage(ctx: SettingsContext): SettingDefinitionPage {
    const label = (key: SettingLabelKey, name: string, desc?: string): SettingDefinition => ({
        name,
        desc,
        control: { type: "text", key, validate: nonEmptyError },
    });
    return {
        type: "page",
        name: "Answer button labels",
        displayValue: () => LABEL_KEYS.map((key) => ctx.settings[key]).join(", "),
        items: [
            {
                type: "group",
                extraButtons: [restoreDefaultsButton(ctx, [...LABEL_KEYS])],
                items: [
                    label(
                        "flashcardAgainText",
                        "Again",
                        "Wording on the button, in menus and in commands.",
                    ),
                    label("flashcardHardText", "Hard"),
                    label("flashcardGoodText", "Good"),
                    label("flashcardEasyText", "Easy"),
                ],
            },
        ],
    };
}

/**
 * The voice list: Automatic, then every voice the device has. Devices load voices a moment after start, so the list
 * is refilled when they change; leaving the page stops that.
 */
function voiceRow(ctx: SettingsContext): SettingDefinition {
    return bindKeys<SettingDefinition>(["speechVoice"], {
        name: "Voice",
        desc: "Automatic picks a voice for Obsidian's language.",
        render: (setting) => {
            const win = activeWindow;
            const synth = speechAvailable(win) ? win.speechSynthesis : null;
            const watcher = synth === null ? null : new VoiceWatcher(synth);
            setting.addDropdown((dropdown) => {
                const fill = () => {
                    const offered = [""];
                    dropdown.selectEl.empty();
                    dropdown.addOption("", "Automatic");
                    for (const voice of synth?.getVoices() ?? []) {
                        dropdown.addOption(voice.voiceURI, `${voice.name} (${voice.lang})`);
                        offered.push(voice.voiceURI);
                    }
                    // A voice this device does not have is shown as Automatic, which is what it falls back to. The
                    // stored choice is left alone: another device, or voices still loading, may have it.
                    const chosen = ctx.settings.speechVoice;
                    dropdown.setValue(offered.includes(chosen) ? chosen : "");
                };
                fill();
                watcher?.watch(dropdown.selectEl, fill);
                dropdown.onChange(async (value) => {
                    ctx.settings.speechVoice = value;
                    await ctx.commit(["speechVoice"]);
                });
            });
            return () => watcher?.dispose();
        },
    });
}

/** Reading cards out loud, on devices that can. */
function readAloudPage(ctx: SettingsContext): SettingDefinitionPage {
    return {
        type: "page",
        name: "Read aloud",
        visible: () => speechAvailable(),
        displayValue: () =>
            ctx.settings.readQuestionAloud || ctx.settings.readAnswerAloud ? "On" : "Off",
        items: [
            {
                type: "group",
                items: [
                    {
                        name: "Read the question",
                        desc: "Speak the question when it shows. Uses your device's voices and works offline.",
                        control: { type: "toggle", key: "readQuestionAloud" },
                    },
                    {
                        name: "Read the answer",
                        desc: "Pictures, code and math are skipped.",
                        control: { type: "toggle", key: "readAnswerAloud" },
                    },
                    voiceRow(ctx),
                    {
                        name: "Speed",
                        control: {
                            type: "slider",
                            key: "speechRate",
                            min: 0.5,
                            max: 2,
                            step: 0.1,
                            displayFormat: (value) => value.toFixed(1) + "×",
                        },
                    },
                ],
            },
        ],
    };
}

/** When a card that keeps being forgotten is set aside. */
function leechesPage(ctx: SettingsContext): SettingDefinitionPage {
    return {
        type: "page",
        name: "Leeches",
        desc: "Only cards scheduled with FSRS become leeches.",
        displayValue: () => {
            const lapses = ctx.settings.leechThreshold;
            if (lapses === 0) return "Off";
            return lapses === 1 ? "After 1 lapse" : "After " + lapses + " lapses";
        },
        items: [
            {
                type: "group",
                items: [
                    {
                        name: "Lapses to become a leech",
                        desc: "0 turns leeches off. After that, every half as many lapses again.",
                        control: {
                            type: "number",
                            key: "leechThreshold",
                            min: 0,
                            max: 99,
                            defaultValue: DEFAULT_SETTINGS.leechThreshold,
                            validate: (value) => wholeNumberError(value, 0, 99),
                        },
                    },
                    {
                        name: "When a card becomes a leech",
                        control: {
                            type: "dropdown",
                            key: "leechAction",
                            options: { suspend: "Mark it and suspend it", tag: "Mark it only" },
                        },
                    },
                ],
            },
        ],
    };
}

/** How a study session runs: daily limits, card order, typing, buttons, reading aloud and leeches. */
export function studyingGroup(ctx: SettingsContext): SettingDefinitionItem[] {
    const rows: SettingGroupItem[] = [
        {
            name: "Daily limits",
            desc: "Cap new cards and reviews per day. Learning steps are never capped.",
            aliases: ["limit", "anki"],
            control: { type: "toggle", key: "dailyLimitsEnabled" },
        },
        {
            name: "New cards per day",
            desc: "Across all decks.",
            control: {
                type: "number",
                key: "newCardsPerDay",
                min: 0,
                max: 9999,
                defaultValue: DEFAULT_SETTINGS.newCardsPerDay,
                step: 1,
                validate: (value) => wholeNumberError(value, 0, 9999),
                disabled: () => !ctx.settings.dailyLimitsEnabled,
            },
        },
        {
            name: "Reviews per day",
            desc: "Across all decks.",
            control: {
                type: "number",
                key: "reviewsPerDay",
                min: 0,
                max: 99999,
                defaultValue: DEFAULT_SETTINGS.reviewsPerDay,
                step: 1,
                validate: (value) => wholeNumberError(value, 0, 99999),
                disabled: () => !ctx.settings.dailyLimitsEnabled,
            },
        },
        {
            name: "Card order",
            desc: "Which card comes next within a deck.",
            control: {
                type: "dropdown",
                key: "flashcardCardOrder",
                options: {
                    DueFirstRandom: "Due cards first, shuffled",
                    DueFirstSequential: "Due cards first, in order",
                    NewFirstRandom: "New cards first, shuffled",
                    NewFirstSequential: "New cards first, in order",
                    EveryCardRandomDeckAndCard: "Any card from any deck",
                },
            },
        },
        {
            name: "Review order",
            desc: "Which due cards come first within a deck. Most at risk puts the cards you are likeliest to have forgotten at the front.",
            control: {
                type: "dropdown",
                key: "reviewOrder",
                options: {
                    dueDate: "Due date",
                    mostAtRisk: "Most at risk first",
                },
            },
        },
        {
            name: "Deck order",
            desc: "Ignored when cards come from any deck.",
            control: {
                type: "dropdown",
                key: "flashcardDeckOrder",
                options: {
                    PrevDeckComplete_Sequential: "One deck at a time, in order",
                    PrevDeckComplete_Random: "One deck at a time, shuffled",
                },
                disabled: () => ctx.settings.flashcardCardOrder === "EveryCardRandomDeckAndCard",
            },
        },
        {
            name: "Bury related cards",
            desc: "After you answer a card, hide the other cards from the same text until tomorrow.",
            aliases: ["sibling"],
            control: { type: "toggle", key: "burySiblingCards" },
        },
        {
            name: "Learn ahead (minutes)",
            desc: "When nothing else is due, show a card due within this many minutes. 0 always waits.",
            visible: () => ctx.settings.algorithm === SchedulerKind.FSRS,
            control: {
                type: "number",
                key: "learnAheadMinutes",
                min: 0,
                max: 1440,
                defaultValue: DEFAULT_SETTINGS.learnAheadMinutes,
                validate: (value) => wholeNumberError(value, 0, 1440),
            },
        },
        {
            name: "Answer keys",
            desc: "Which number keys answer a card.",
            aliases: ["keyboard", "shortcut"],
            control: {
                type: "dropdown",
                key: "answerKeys",
                options: {
                    anki: "1 Again, 2 Hard, 3 Good, 4 Easy",
                    original: "1 Hard, 2 Good, 3 Easy, 0 Reset",
                },
            },
        },
        {
            name: "Button delay",
            desc: "Ignore extra presses for this long after you answer.",
            control: {
                type: "slider",
                key: "reviewButtonDelay",
                min: 0,
                max: 5000,
                step: 100,
                displayFormat: (value) => (value === 0 ? "Off" : (value / 1000).toFixed(1) + " s"),
            },
        },
        {
            name: "Type your answers",
            desc: "Type the answer to short cards and fill in cloze blanks. Enter checks it.",
            aliases: ["typing", "input"],
            control: { type: "toggle", key: "typeAnswers" },
        },
        {
            name: t("AI_MEANING_SETTING"),
            desc: t("AI_MEANING_SETTING_DESC"),
            visible: () => ctx.settings.typeAnswers,
            control: {
                type: "dropdown",
                key: "typedAnswerEvaluation",
                options: { deterministic: t("AI_MEANING_OFF"), "ai-assisted": t("AI_MEANING_ON") },
                validate: typedAnswerEvaluationError,
            },
        },
        {
            name: "Ignore accents",
            desc: "A typed answer matches with or without accents, so cafe matches café.",
            control: { type: "toggle", key: "ignoreAccentsWhenTyping" },
        },
        {
            name: "Shuffle choices",
            desc: "Show multiple-choice options in a new order each time.",
            aliases: ["multiple choice"],
            control: { type: "toggle", key: "shuffleChoices" },
        },
        {
            name: "Blanks as input fields",
            desc: "Show cloze blanks as fields you can type into.",
            // Typing answers already turns every blank into a field, so there is nothing to choose while it is on.
            visible: () => !ctx.settings.typeAnswers,
            control: { type: "toggle", key: "convertClozePatternsToInputs" },
        },
        {
            name: "Show intervals on buttons",
            desc: "Each answer button shows when the card comes back.",
            control: { type: "toggle", key: "showIntervalInReviewButtons" },
        },
        {
            name: "Exam pass mark",
            desc: "The score you aim for in practice exams.",
            control: {
                type: "slider",
                key: "examPassPercent",
                min: 1,
                max: 100,
                step: 1,
                displayFormat: (value) => value + "%",
            },
        },
        answerLabelsPage(ctx),
        readAloudPage(ctx),
        leechesPage(ctx),
    ];
    return [{ type: "group", heading: "Studying", items: rows }];
}
