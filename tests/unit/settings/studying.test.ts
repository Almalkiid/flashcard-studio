import type {
    ExtraButtonComponent,
    Setting,
    SettingDefinition,
    SettingDefinitionGroup,
    SettingDefinitionItem,
    SettingDefinitionPage,
    SettingGroup,
} from "obsidian";

import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { coveredKeys } from "src/settings/definitions/helpers";
import { studyingGroup } from "src/settings/definitions/studying";
import { freshInstallSettings } from "src/settings/fresh-defaults";
import { speechAvailable, VoiceWatcher } from "src/ui/speech";

import { fakeContext } from "../helpers/fake-settings-context";

jest.mock("src/ui/speech", () => ({
    speechAvailable: jest.fn(() => true),
    VoiceWatcher: jest.fn().mockImplementation(() => ({ watch: jest.fn(), dispose: jest.fn() })),
}));

const speechAvailableMock = speechAvailable as jest.Mock<boolean, []>;
const voiceWatcherMock = VoiceWatcher as unknown as jest.Mock<
    { watch: jest.Mock; dispose: jest.Mock },
    [EventTarget]
>;

/** The watcher the render made (the mocked VoiceWatcher hands back this object from `new`). */
const firstWatcher = () =>
    voiceWatcherMock.mock.results[0].value as {
        watch: jest.Mock<void, [unknown, () => void]>;
        dispose: jest.Mock<void, []>;
    };

type Predicate = boolean | (() => boolean) | undefined;
const isPage = (item: SettingDefinitionItem): item is SettingDefinitionPage =>
    "type" in item && item.type === "page";
const truth = (value: Predicate) => (typeof value === "function" ? value() : value);

/** Every definition, however deep inside groups and pages. */
function walk(
    items: readonly SettingDefinitionItem[],
    visit: (item: SettingDefinitionItem) => void,
) {
    for (const item of items) {
        visit(item);
        if ("items" in item && item.items !== undefined) walk(item.items, visit);
    }
}

/** The row whose control stores `key`. */
function findControl(items: readonly SettingDefinitionItem[], key: string): SettingDefinition {
    let found: SettingDefinition | undefined;
    walk(items, (item) => {
        if ("control" in item && item.control?.key === key) found = item;
    });
    if (found === undefined) throw new Error("No control for " + key);
    return found;
}

function findRow(items: readonly SettingDefinitionItem[], name: string): SettingDefinition {
    let found: SettingDefinition | undefined;
    walk(items, (item) => {
        if (!isPage(item) && "name" in item && item.name === name) found = item;
    });
    if (found === undefined) throw new Error("No row " + name);
    return found;
}

function build(speech = true) {
    speechAvailableMock.mockReturnValue(speech);
    const fake = fakeContext();
    const items = studyingGroup(fake.ctx);
    const group = items[0] as SettingDefinitionGroup;
    const pages = (group.items ?? []).filter(isPage);
    const page = (name: string) => {
        const found = pages.find((candidate) => candidate.name === name);
        if (found === undefined) throw new Error("No page " + name);
        return found;
    };
    return { ...fake, items, group, pages, page };
}

/** The one headless group inside a page, which is where its rows and header buttons sit. */
function pageGroup(page: SettingDefinitionPage): SettingDefinitionGroup {
    expect(page.items).toHaveLength(1);
    const group = page.items?.[0] as SettingDefinitionGroup;
    expect(group.type).toBe("group");
    expect(group.heading).toBeUndefined();
    return group;
}

const validateOf = (def: SettingDefinition) =>
    def.control?.validate as (value: never) => string | undefined;

beforeEach(() => jest.clearAllMocks());

describe("the group", () => {
    test("it is one group headed Studying, with rows in order and then three pages", () => {
        const { items, group } = build();
        expect(items).toHaveLength(1);
        expect(group.type).toBe("group");
        expect(group.heading).toBe("Studying");
        expect((group.items ?? []).map((item) => (item as { name: string }).name)).toEqual([
            "Daily limits",
            "New cards per day",
            "Reviews per day",
            "Card order",
            "Review order",
            "Deck order",
            "Bury related cards",
            "Learn ahead (minutes)",
            "Answer keys",
            "Button delay",
            "Type your answers",
            "Check meaning with AI",
            "Ignore accents",
            "Shuffle choices",
            "Blanks as input fields",
            "Show intervals on buttons",
            "Exam pass mark",
            "Answer button labels",
            "Read aloud",
            "Leeches",
        ]);
        expect((group.items ?? []).slice(-3).every(isPage)).toBe(true);
    });

    test("every stored key of the group is covered", () => {
        const { items } = build();
        expect(coveredKeys(items)).toEqual(
            new Set([
                "dailyLimitsEnabled",
                "newCardsPerDay",
                "reviewsPerDay",
                "flashcardCardOrder",
                "reviewOrder",
                "flashcardDeckOrder",
                "burySiblingCards",
                "learnAheadMinutes",
                "answerKeys",
                "reviewButtonDelay",
                "typeAnswers",
                "typedAnswerEvaluation",
                "ignoreAccentsWhenTyping",
                "shuffleChoices",
                "convertClozePatternsToInputs",
                "showIntervalInReviewButtons",
                "examPassPercent",
                "flashcardAgainText",
                "flashcardHardText",
                "flashcardGoodText",
                "flashcardEasyText",
                "readQuestionAloud",
                "readAnswerAloud",
                "speechVoice",
                "speechRate",
                "leechThreshold",
                "leechAction",
            ]),
        );
    });
});

describe("the rows", () => {
    const toggles: [string, string, string, string[] | undefined][] = [
        [
            "dailyLimitsEnabled",
            "Daily limits",
            "Cap new cards and reviews per day. Learning steps are never capped.",
            ["limit", "anki"],
        ],
        [
            "burySiblingCards",
            "Bury related cards",
            "After you answer a card, hide the other cards from the same text until tomorrow.",
            ["sibling"],
        ],
        [
            "typeAnswers",
            "Type your answers",
            "Type the answer to short cards and fill in cloze blanks. Enter checks it.",
            ["typing", "input"],
        ],
        [
            "ignoreAccentsWhenTyping",
            "Ignore accents",
            "A typed answer matches with or without accents, so cafe matches café.",
            undefined,
        ],
        [
            "shuffleChoices",
            "Shuffle choices",
            "Show multiple-choice options in a new order each time.",
            ["multiple choice"],
        ],
        [
            "convertClozePatternsToInputs",
            "Blanks as input fields",
            "Show cloze blanks as fields you can type into.",
            undefined,
        ],
        [
            "showIntervalInReviewButtons",
            "Show intervals on buttons",
            "Each answer button shows when the card comes back.",
            undefined,
        ],
    ];

    test.each(toggles)(
        "%s is a toggle with its name, description and aliases",
        (key, name, desc, aliases) => {
            const { items } = build();
            const row = findControl(items, key);
            expect(row.name).toBe(name);
            expect(row.desc).toBe(desc);
            expect(row.aliases).toEqual(aliases);
            expect(row.control).toMatchObject({ type: "toggle", key });
        },
    );

    test("new cards per day is a whole number from 0 to 9999, off with the limits", () => {
        const { items, settings } = build();
        const row = findControl(items, "newCardsPerDay");
        expect(row.name).toBe("New cards per day");
        expect(row.desc).toBe("Across all decks.");
        expect(row.control).toMatchObject({ type: "number", min: 0, max: 9999, step: 1 });

        const validate = validateOf(row);
        expect(validate(-1 as never)).toBe("Use a number from 0 to 9999.");
        expect(validate(2.5 as never)).toBe("Use a whole number.");
        expect(validate(10000 as never)).toBe("Use a number from 0 to 9999.");
        expect(validate(0 as never)).toBeUndefined();
        expect(validate(20 as never)).toBeUndefined();

        const disabled = (row.control as { disabled?: Predicate }).disabled;
        expect(typeof disabled).toBe("function");
        settings.dailyLimitsEnabled = true;
        expect(truth(disabled)).toBe(false);
        settings.dailyLimitsEnabled = false;
        expect(truth(disabled)).toBe(true);
    });

    test("reviews per day is a whole number from 0 to 99999, off with the limits", () => {
        const { items, settings } = build();
        const row = findControl(items, "reviewsPerDay");
        expect(row.name).toBe("Reviews per day");
        expect(row.desc).toBe("Across all decks.");
        expect(row.control).toMatchObject({ type: "number", min: 0, max: 99999, step: 1 });

        const validate = validateOf(row);
        expect(validate(-1 as never)).toBe("Use a number from 0 to 99999.");
        expect(validate(0.5 as never)).toBe("Use a whole number.");
        expect(validate(100000 as never)).toBe("Use a number from 0 to 99999.");
        expect(validate(200 as never)).toBeUndefined();

        const disabled = (row.control as { disabled?: Predicate }).disabled;
        settings.dailyLimitsEnabled = true;
        expect(truth(disabled)).toBe(false);
        settings.dailyLimitsEnabled = false;
        expect(truth(disabled)).toBe(true);
    });

    test("card order offers the five orders", () => {
        const { items } = build();
        const row = findControl(items, "flashcardCardOrder");
        expect(row.name).toBe("Card order");
        expect(row.desc).toBe("Which card comes next within a deck.");
        expect(row.control).toMatchObject({ type: "dropdown" });
        expect(Object.entries((row.control as { options: object }).options)).toEqual([
            ["DueFirstRandom", "Due cards first, shuffled"],
            ["DueFirstSequential", "Due cards first, in order"],
            ["NewFirstRandom", "New cards first, shuffled"],
            ["NewFirstSequential", "New cards first, in order"],
            ["EveryCardRandomDeckAndCard", "Any card from any deck"],
        ]);
    });

    test("review order offers the due date order and the most at risk order", () => {
        const { items, settings } = build();
        const row = findControl(items, "reviewOrder");
        expect(row.name).toBe("Review order");
        expect(row.desc).toContain("Which due cards come first within a deck");
        expect(row.control).toMatchObject({ type: "dropdown" });
        expect(Object.entries((row.control as { options: object }).options)).toEqual([
            ["dueDate", "Due date"],
            ["mostAtRisk", "Most at risk first"],
        ]);
        // A fresh install and an old one both start on the due date order
        expect(settings.reviewOrder).toBe("dueDate");
        // It does not depend on the card order: it is never disabled
        expect((row.control as { disabled?: Predicate }).disabled).toBeUndefined();
    });

    test("deck order is disabled exactly when cards come from any deck", () => {
        const { items, settings } = build();
        const row = findControl(items, "flashcardDeckOrder");
        expect(row.name).toBe("Deck order");
        expect(row.desc).toBe("Ignored when cards come from any deck.");
        expect(row.control).toMatchObject({ type: "dropdown" });
        expect(Object.entries((row.control as { options: object }).options)).toEqual([
            ["PrevDeckComplete_Sequential", "One deck at a time, in order"],
            ["PrevDeckComplete_Random", "One deck at a time, shuffled"],
        ]);

        const disabled = (row.control as { disabled?: Predicate }).disabled;
        expect(typeof disabled).toBe("function");
        for (const order of [
            "DueFirstRandom",
            "DueFirstSequential",
            "NewFirstRandom",
            "NewFirstSequential",
        ]) {
            settings.flashcardCardOrder = order;
            expect(truth(disabled)).toBe(false);
        }
        settings.flashcardCardOrder = "EveryCardRandomDeckAndCard";
        expect(truth(disabled)).toBe(true);
        settings.flashcardCardOrder = "DueFirstRandom";
        expect(truth(disabled)).toBe(false);
    });

    test("learn ahead is a whole number of minutes, shown only on FSRS", () => {
        const { items, settings } = build();
        const row = findControl(items, "learnAheadMinutes");
        expect(row.name).toBe("Learn ahead (minutes)");
        expect(row.desc).toBe(
            "When nothing else is due, show a card due within this many minutes. 0 always waits.",
        );
        expect(row.control).toMatchObject({ type: "number", min: 0, max: 1440 });

        const validate = validateOf(row);
        expect(validate(-1 as never)).toBe("Use a number from 0 to 1440.");
        expect(validate(1.5 as never)).toBe("Use a whole number.");
        expect(validate(1441 as never)).toBe("Use a number from 0 to 1440.");
        expect(validate(20 as never)).toBeUndefined();

        expect(typeof row.visible).toBe("function");
        settings.algorithm = SchedulerKind.FSRS;
        expect(truth(row.visible)).toBe(true);
        settings.algorithm = SchedulerKind.SM2;
        expect(truth(row.visible)).toBe(false);
        settings.algorithm = SchedulerKind.FSRS;
        expect(truth(row.visible)).toBe(true);
    });

    test("answer keys offers the two layouts", () => {
        const { items } = build();
        const row = findControl(items, "answerKeys");
        expect(row.name).toBe("Answer keys");
        expect(row.desc).toBe("Which number keys answer a card.");
        expect(row.aliases).toEqual(["keyboard", "shortcut"]);
        expect(row.control).toMatchObject({ type: "dropdown" });
        expect(Object.entries((row.control as { options: object }).options)).toEqual([
            ["anki", "1 Again, 2 Hard, 3 Good, 4 Easy"],
            ["original", "1 Hard, 2 Good, 3 Easy, 0 Reset"],
        ]);
    });

    test("button delay is a slider that says Off at zero", () => {
        const { items } = build();
        const row = findControl(items, "reviewButtonDelay");
        expect(row.name).toBe("Button delay");
        expect(row.desc).toBe("Ignore extra presses for this long after you answer.");
        expect(row.control).toMatchObject({ type: "slider", min: 0, max: 5000, step: 100 });
        const format = (row.control as { displayFormat: (value: number) => string }).displayFormat;
        expect(format(0)).toBe("Off");
        expect(format(100)).toBe("0.1 s");
        expect(format(1500)).toBe("1.5 s");
        expect(format(5000)).toBe("5.0 s");
    });

    test("blanks as input fields is hidden while typing answers is on, and shown while it is off", () => {
        const { items, settings } = build();
        const row = findControl(items, "convertClozePatternsToInputs");
        expect(typeof row.visible).toBe("function");
        expect((row.control as { disabled?: Predicate }).disabled).toBeUndefined();
        settings.typeAnswers = false;
        expect(truth(row.visible)).toBe(true);
        settings.typeAnswers = true;
        expect(truth(row.visible)).toBe(false);
        settings.typeAnswers = false;
        expect(truth(row.visible)).toBe(true);
    });

    test("exam pass mark is a percent slider", () => {
        const { items } = build();
        const row = findControl(items, "examPassPercent");
        expect(row.name).toBe("Exam pass mark");
        expect(row.desc).toBe("The score you aim for in practice exams.");
        expect(row.control).toMatchObject({ type: "slider", min: 1, max: 100, step: 1 });
        const format = (row.control as { displayFormat: (value: number) => string }).displayFormat;
        expect(format(75)).toBe("75%");
    });
});

describe("the answer button labels page", () => {
    const labels = [
        ["flashcardAgainText", "Again"],
        ["flashcardHardText", "Hard"],
        ["flashcardGoodText", "Good"],
        ["flashcardEasyText", "Easy"],
    ] as const;

    test("it is a page named Answer button labels with one headless group", () => {
        const { page } = build();
        const labelPage = page("Answer button labels");
        expect(labelPage.type).toBe("page");
        expect(labelPage.visible).toBeUndefined();
        expect(pageGroup(labelPage).items).toHaveLength(4);
    });

    test("it has a text row per button, the description only on the first, none allowed empty", () => {
        const { page } = build();
        const rows = (pageGroup(page("Answer button labels")).items ?? []) as SettingDefinition[];
        expect(rows.map((row) => row.name)).toEqual(labels.map(([, name]) => name));
        labels.forEach(([key, name], index) => {
            expect(rows[index].control).toMatchObject({ type: "text", key });
            expect(rows[index].name).toBe(name);
            expect(rows[index].desc).toBe(
                index === 0 ? "Wording on the button, in menus and in commands." : undefined,
            );
            const validate = validateOf(rows[index]);
            expect(validate("" as never)).toBe("Can't be empty.");
            expect(validate("   " as never)).toBe("Can't be empty.");
            expect(validate("Nope" as never)).toBeUndefined();
        });
    });

    test("its entry lists the four labels as they are now", () => {
        const { page, settings } = build();
        const labelPage = page("Answer button labels");
        expect(typeof labelPage.displayValue).toBe("function");
        const show = () => (labelPage.displayValue as () => string)();

        settings.flashcardAgainText = "Again";
        settings.flashcardHardText = "Hard";
        settings.flashcardGoodText = "Good";
        settings.flashcardEasyText = "Easy";
        expect(show()).toBe("Again, Hard, Good, Easy");

        settings.flashcardGoodText = "Got it";
        expect(show()).toBe("Again, Hard, Got it, Easy");
    });

    test("the header button restores the four labels after asking", async () => {
        const { page, settings, mocks } = build();
        const labelGroup = pageGroup(page("Answer button labels"));
        expect(labelGroup.extraButtons).toHaveLength(1);

        let clicked: (() => void) | undefined;
        const button = {
            setIcon: () => button,
            setTooltip: () => button,
            onClick: (fn: () => void) => ((clicked = fn), button),
        };
        labelGroup.extraButtons?.[0](button as unknown as ExtraButtonComponent);

        settings.flashcardGoodText = "Got it";
        settings.flashcardEasyText = "Brilliant";
        settings.newCardsPerDay = 99;
        clicked?.();
        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(settings.flashcardGoodText).toBe("Got it");

        await mocks.confirm.mock.calls[0][2]();
        const fresh = freshInstallSettings();
        expect(settings.flashcardGoodText).toBe(fresh.flashcardGoodText);
        expect(settings.flashcardEasyText).toBe(fresh.flashcardEasyText);
        expect(settings.newCardsPerDay).toBe(99);
        expect(mocks.commit).toHaveBeenCalledWith([
            "flashcardAgainText",
            "flashcardHardText",
            "flashcardGoodText",
            "flashcardEasyText",
        ]);
        expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    });
});

describe("the read aloud page", () => {
    const voices = [
        { voiceURI: "urn:alex", name: "Alex", lang: "en-US" },
        { voiceURI: "urn:amelie", name: "Amelie", lang: "fr-CA" },
    ];
    let getVoices: jest.Mock<typeof voices, []>;
    /** Obsidian's active window; a popout is not `window`, so the render must use this one. */
    let activeWin: { speechSynthesis: { getVoices: typeof getVoices } };

    beforeEach(() => {
        getVoices = jest.fn(() => voices);
        activeWin = { speechSynthesis: { getVoices } };
        Object.defineProperty(window, "activeWindow", {
            configurable: true,
            value: activeWin,
        });
    });

    afterEach(() => {
        Reflect.deleteProperty(window, "activeWindow");
    });

    /** A dropdown that remembers what it was given, standing in for Obsidian's. */
    function fakeDropdown() {
        const state = {
            options: [] as [string, string][],
            value: undefined as string | undefined,
            changed: undefined as ((value: string) => unknown) | undefined,
        };
        const selectEl = {
            isConnected: true,
            empty: () => {
                state.options.length = 0;
            },
        };
        const dropdown = {
            selectEl,
            addOption: (value: string, label: string) => (
                state.options.push([value, label]),
                dropdown
            ),
            setValue: (value: string) => ((state.value = value), dropdown),
            onChange: (fn: (value: string) => unknown) => ((state.changed = fn), dropdown),
        };
        const setting = {
            addDropdown: (callback: (component: typeof dropdown) => void) => (
                callback(dropdown),
                setting
            ),
        };
        return { state, selectEl, setting: setting as unknown as Setting };
    }

    function renderVoice(settingsOverride?: (settings: { speechVoice: string }) => void) {
        const built = build();
        settingsOverride?.(built.settings);
        const row = findRow(built.items, "Voice") as unknown as {
            render: (setting: Setting, group: SettingGroup) => void | (() => void);
        };
        const dropdown = fakeDropdown();
        const cleanup = row.render(dropdown.setting, {} as SettingGroup);
        return { ...built, ...dropdown, cleanup, row };
    }

    test("it is a page named Read aloud, shown only when the device can speak", () => {
        const { page } = build(true);
        const readAloud = page("Read aloud");
        expect(typeof readAloud.visible).toBe("function");
        expect(truth(readAloud.visible)).toBe(true);

        speechAvailableMock.mockReturnValue(false);
        expect(truth(readAloud.visible)).toBe(false);
        speechAvailableMock.mockReturnValue(true);
        expect(truth(readAloud.visible)).toBe(true);
    });

    test("it is hidden when speech is not available", () => {
        const { page } = build(false);
        expect(truth(page("Read aloud").visible)).toBe(false);
    });

    test("its entry says On when either text is read, and Off when neither is", () => {
        const { page, settings } = build();
        const show = () => (page("Read aloud").displayValue as () => string)();
        settings.readQuestionAloud = false;
        settings.readAnswerAloud = false;
        expect(show()).toBe("Off");
        settings.readQuestionAloud = true;
        expect(show()).toBe("On");
        settings.readQuestionAloud = false;
        settings.readAnswerAloud = true;
        expect(show()).toBe("On");
        settings.readQuestionAloud = true;
        expect(show()).toBe("On");
    });

    test("it holds the two toggles, the voice and the speed in one headless group", () => {
        const { page } = build();
        const rows = (pageGroup(page("Read aloud")).items ?? []) as SettingDefinition[];
        expect(rows.map((row) => row.name)).toEqual([
            "Read the question",
            "Read the answer",
            "Voice",
            "Speed",
        ]);
        expect(rows[0].desc).toBe(
            "Speak the question when it shows. Uses your device's voices and works offline.",
        );
        expect(rows[0].control).toMatchObject({ type: "toggle", key: "readQuestionAloud" });
        expect(rows[1].desc).toBe("Pictures, code and math are skipped.");
        expect(rows[1].control).toMatchObject({ type: "toggle", key: "readAnswerAloud" });
        expect(rows[2].desc).toBe("Automatic picks a voice for Obsidian's language.");
        expect(rows[2].control).toBeUndefined();
        expect(rows[3].control).toMatchObject({
            type: "slider",
            key: "speechRate",
            min: 0.5,
            max: 2,
            step: 0.1,
        });
        const format = (rows[3].control as { displayFormat: (value: number) => string })
            .displayFormat;
        expect(format(1)).toBe("1.0×");
        expect(format(0.5)).toBe("0.5×");
        expect(format(1.7)).toBe("1.7×");
    });

    test("the voice list is Automatic and then every voice of the device", () => {
        const { state } = renderVoice();
        expect(state.options).toEqual([
            ["", "Automatic"],
            ["urn:alex", "Alex (en-US)"],
            ["urn:amelie", "Amelie (fr-CA)"],
        ]);
        expect(state.value).toBe("");
    });

    test("the chosen voice is selected", () => {
        const { state } = renderVoice((settings) => {
            settings.speechVoice = "urn:amelie";
        });
        expect(state.value).toBe("urn:amelie");
    });

    test("a stored voice this device does not have shows as Automatic and is left stored", () => {
        const { state, settings, mocks } = renderVoice((s) => {
            s.speechVoice = "urn:from-another-device";
        });
        expect(state.options.map(([value]) => value)).not.toContain("urn:from-another-device");
        expect(state.value).toBe("");
        expect(settings.speechVoice).toBe("urn:from-another-device");
        expect(mocks.commit).not.toHaveBeenCalled();
    });

    test("a stored voice that arrives with a later refill is selected then", () => {
        const { state, settings } = renderVoice((s) => {
            s.speechVoice = "urn:kenji";
        });
        expect(state.value).toBe("");
        getVoices.mockReturnValue([
            ...voices,
            { voiceURI: "urn:kenji", name: "Kenji", lang: "ja-JP" },
        ]);
        firstWatcher().watch.mock.calls[0][1]();
        expect(state.value).toBe("urn:kenji");
        expect(settings.speechVoice).toBe("urn:kenji");
    });

    test("choosing a voice stores it and saves", async () => {
        const { state, settings, mocks } = renderVoice();
        await state.changed?.("urn:alex");
        expect(settings.speechVoice).toBe("urn:alex");
        expect(mocks.commit).toHaveBeenCalledWith(["speechVoice"]);
        await state.changed?.("");
        expect(settings.speechVoice).toBe("");
        expect(mocks.commit).toHaveBeenCalledTimes(2);
    });

    test("the list is refilled when the device's voices change, keeping the chosen voice", () => {
        const { state, selectEl, settings } = renderVoice((s) => {
            s.speechVoice = "urn:amelie";
        });
        expect(voiceWatcherMock).toHaveBeenCalledTimes(1);
        expect(speechAvailableMock).toHaveBeenCalledWith(activeWin);
        expect(voiceWatcherMock).toHaveBeenCalledWith(activeWin.speechSynthesis);
        expect(window).not.toHaveProperty("speechSynthesis");
        const watcher = firstWatcher();
        expect(watcher.watch).toHaveBeenCalledTimes(1);
        expect(watcher.watch.mock.calls[0][0]).toBe(selectEl);

        // The device adds a voice after the page was drawn.
        getVoices.mockReturnValue([
            ...voices,
            { voiceURI: "urn:kenji", name: "Kenji", lang: "ja-JP" },
        ]);
        settings.speechVoice = "urn:kenji";
        watcher.watch.mock.calls[0][1]();
        expect(state.options).toEqual([
            ["", "Automatic"],
            ["urn:alex", "Alex (en-US)"],
            ["urn:amelie", "Amelie (fr-CA)"],
            ["urn:kenji", "Kenji (ja-JP)"],
        ]);
        expect(state.value).toBe("urn:kenji");
    });

    test("leaving the page stops the watcher", () => {
        const { cleanup } = renderVoice();
        const watcher = firstWatcher();
        expect(typeof cleanup).toBe("function");
        expect(watcher.dispose).not.toHaveBeenCalled();
        (cleanup as () => void)();
        expect(watcher.dispose).toHaveBeenCalledTimes(1);
    });

    test("a device that cannot speak gets Automatic only and no watcher", () => {
        speechAvailableMock.mockReturnValue(false);
        const built = build(false);
        const row = findRow(built.items, "Voice") as unknown as {
            render: (setting: Setting, group: SettingGroup) => void | (() => void);
        };
        const dropdown = fakeDropdown();
        const cleanup = row.render(dropdown.setting, {} as SettingGroup);
        expect(dropdown.state.options).toEqual([["", "Automatic"]]);
        expect(getVoices).not.toHaveBeenCalled();
        expect(voiceWatcherMock).not.toHaveBeenCalled();
        expect(() => (cleanup as () => void)()).not.toThrow();
    });
});

describe("the leeches page", () => {
    test("it is a page named Leeches that says it needs FSRS", () => {
        const { page } = build();
        const leeches = page("Leeches");
        expect(leeches.desc).toBe("Only cards scheduled with FSRS become leeches.");
        expect(leeches.visible).toBeUndefined();
        expect(pageGroup(leeches).items).toHaveLength(2);
    });

    test("its entry says Off at zero and the lapses otherwise, as they are now", () => {
        const { page, settings } = build();
        const show = () => (page("Leeches").displayValue as () => string)();
        settings.leechThreshold = 0;
        expect(show()).toBe("Off");
        settings.leechThreshold = 1;
        expect(show()).toBe("After 1 lapse");
        settings.leechThreshold = 8;
        expect(show()).toBe("After 8 lapses");
        settings.leechThreshold = 3;
        expect(show()).toBe("After 3 lapses");
    });

    test("the threshold is a whole number from 0 to 99", () => {
        const { items } = build();
        const row = findControl(items, "leechThreshold");
        expect(row.name).toBe("Lapses to become a leech");
        expect(row.desc).toBe("0 turns leeches off. After that, every half as many lapses again.");
        expect(row.control).toMatchObject({ type: "number", min: 0, max: 99 });
        const validate = validateOf(row);
        expect(validate(-1 as never)).toBe("Use a number from 0 to 99.");
        expect(validate(1.5 as never)).toBe("Use a whole number.");
        expect(validate(100 as never)).toBe("Use a number from 0 to 99.");
        expect(validate(0 as never)).toBeUndefined();
        expect(validate(8 as never)).toBeUndefined();
    });

    test("the action offers suspend or tag only", () => {
        const { items } = build();
        const row = findControl(items, "leechAction");
        expect(row.name).toBe("When a card becomes a leech");
        expect(row.control).toMatchObject({ type: "dropdown" });
        expect(Object.entries((row.control as { options: object }).options)).toEqual([
            ["suspend", "Mark it and suspend it"],
            ["tag", "Mark it only"],
        ]);
    });
});

test("meaning checking is visible only when typing is on and validates its modes", () => {
    const { items, settings } = build();
    const row = findControl(items, "typedAnswerEvaluation");
    settings.typeAnswers = false;
    expect(truth(row.visible)).toBe(false);
    settings.typeAnswers = true;
    expect(truth(row.visible)).toBe(true);
    expect(validateOf(row)("invalid" as never)).toBeDefined();
});
