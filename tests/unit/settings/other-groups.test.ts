import type {
    Setting,
    SettingDefinition,
    SettingDefinitionGroup,
    SettingDefinitionItem,
    SettingDefinitionPage,
    SettingGroup,
} from "obsidian";

import { cloneDefaultSettings, DEFAULT_SETTINGS } from "src/data/settings-model";
import { aiGroup } from "src/settings/definitions/ai";
import { displayGroup } from "src/settings/definitions/display";
import { coveredKeys } from "src/settings/definitions/helpers";
import { noteReviewGroup } from "src/settings/definitions/note-review";
import { remindersGroup } from "src/settings/definitions/reminders";

import { fakeContext } from "../helpers/fake-settings-context";

jest.mock("src/settings/settings.css", () => ({}));
jest.mock("obsidian", () => {
    class SecretComponent {
        value = "";
        changed: ((value: string) => unknown) | undefined;
        constructor(
            public app: unknown,
            public containerEl: unknown,
        ) {}
        setValue(value: string) {
            this.value = value;
            return this;
        }
        onChange(fn: (value: string) => unknown) {
            this.changed = fn;
            return this;
        }
    }
    return {
        ...jest.requireActual<Record<string, unknown>>("../support/obsidian"),
        SecretComponent,
    };
});

type Predicate = boolean | (() => boolean) | undefined;
type Validate = (value: never) => string | undefined;
const truth = (value: Predicate) => (typeof value === "function" ? value() : value);
const isPage = (item: SettingDefinitionItem): item is SettingDefinitionPage =>
    "type" in item && item.type === "page";

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

const validateOf = (row: SettingDefinition) => row.control?.validate as Validate;
const disabledOf = (row: SettingDefinition) => (row.control as { disabled?: Predicate }).disabled;

/** The one headed group a builder returns, and the names of its rows in order. */
function onlyGroup(items: SettingDefinitionItem[]) {
    expect(items).toHaveLength(1);
    const group = items[0] as SettingDefinitionGroup;
    expect(group.type).toBe("group");
    const names = (group.items ?? []).map((item) => (item as { name: string }).name);
    return { group, names };
}

type ToggleCase = [key: string, name: string, desc: string | undefined, aliases?: string[]];

/** Each toggle row has exactly this name, description and aliases. */
function expectToggles(items: SettingDefinitionItem[], cases: ToggleCase[]) {
    for (const [key, name, desc, aliases] of cases) {
        const row = findControl(items, key);
        expect(row.name).toBe(name);
        expect(row.desc).toBe(desc);
        expect(row.aliases).toEqual(aliases);
        expect(row.control).toMatchObject({ type: "toggle", key });
    }
}

const phone = { env: { isMobile: true } };

describe("note review", () => {
    function build() {
        const fake = fakeContext();
        const items = noteReviewGroup(fake.ctx);
        return { ...fake, items, ...onlyGroup(items) };
    }

    test("it is one group headed Note review with seven rows in order", () => {
        const { group, names } = build();
        expect(group.heading).toBe("Note review");
        expect(names).toEqual([
            "Review tags",
            "Tags to skip",
            "Date format",
            "Open the next note",
            "Random order",
            "Review pane at startup",
            "Days shown in the pane",
        ]);
    });

    test("every stored key of the group is covered", () => {
        expect(coveredKeys(build().items)).toEqual(
            new Set([
                "tagsToReview",
                "noteTagsToIgnore",
                "preferredDateFormatForNoteReviewQueue",
                "autoNextNote",
                "openRandomNote",
                "enableNoteReviewPaneOnStartup",
                "maxNDaysNotesReviewQueue",
            ]),
        );
    });

    test("review tags is a text row that rejects a tag without a hash", () => {
        const row = findControl(build().items, "tagsToReview");
        expect(row.name).toBe("Review tags");
        expect(row.desc).toBe("Notes with any of these tags join note review.");
        expect(row.control).toMatchObject({ type: "text", placeholder: "#review" });
        const validate = validateOf(row);
        expect(validate("review" as never)).toBe("Tags start with #, such as #flashcards.");
        expect(validate("#review review" as never)).toBe("Tags start with #, such as #flashcards.");
        expect(validate("#review #later" as never)).toBeUndefined();
        expect(validate("" as never)).toBeUndefined();
    });

    test("tags to skip is a text row that rejects a tag without a hash", () => {
        const row = findControl(build().items, "noteTagsToIgnore");
        expect(row.name).toBe("Tags to skip");
        expect(row.desc).toBe("Notes with any of these tags stay out of note review.");
        expect(row.control).toMatchObject({ type: "text" });
        const validate = validateOf(row);
        expect(validate("review" as never)).toBe("Tags start with #, such as #flashcards.");
        expect(validate("#private" as never)).toBeUndefined();
    });

    test("date format is a text row that cannot be empty", () => {
        const row = findControl(build().items, "preferredDateFormatForNoteReviewQueue");
        expect(row.name).toBe("Date format");
        expect(row.desc).toBe("How due dates show in the review pane, as a Moment.js format.");
        expect(row.control).toMatchObject({ type: "text", placeholder: "MMM DD YYYY" });
        const validate = validateOf(row);
        expect(validate("" as never)).toBe("Can't be empty.");
        expect(validate("  " as never)).toBe("Can't be empty.");
        expect(validate("DD/MM/YYYY" as never)).toBeUndefined();
    });

    test("the three toggles have their names, descriptions and no aliases", () => {
        expectToggles(build().items, [
            ["autoNextNote", "Open the next note", "After you rate a note, open the next one due."],
            [
                "openRandomNote",
                "Random order",
                "Pick due notes at random instead of by how linked they are.",
            ],
            [
                "enableNoteReviewPaneOnStartup",
                "Review pane at startup",
                "Open the note review pane when Obsidian starts.",
            ],
        ]);
    });

    test("days shown in the pane is a whole number from 1 to 36500", () => {
        const row = findControl(build().items, "maxNDaysNotesReviewQueue");
        expect(row.name).toBe("Days shown in the pane");
        expect(row.desc).toBe("Notes due later than this are left out of the pane.");
        expect(row.control).toMatchObject({ type: "number", min: 1, max: 36500 });
        const validate = validateOf(row);
        expect(validate(0 as never)).toBe("Use a number from 1 to 36500.");
        expect(validate(36501 as never)).toBe("Use a number from 1 to 36500.");
        expect(validate(1.5 as never)).toBe("Use a whole number.");
        expect(validate(1 as never)).toBeUndefined();
        expect(validate(365 as never)).toBeUndefined();
    });
});

describe("display", () => {
    function build(settings = cloneDefaultSettings(), overrides = {}) {
        const fake = fakeContext(settings, overrides);
        const items = displayGroup(fake.ctx);
        return { ...fake, items, ...onlyGroup(items) };
    }

    test("it is one group headed Display, its rows in order and then the Status bar page", () => {
        const { group, names } = build();
        expect(group.heading).toBe("Display");
        expect(names).toEqual([
            "Look",
            "Desktop layout",
            "Your name",
            "Open in a tab",
            "Window height",
            "Window width",
            "Show where a card comes from",
            "Expand decks",
            "Custom hotkeys",
            "Rate notes from the file menu",
            "Delete schedules from the file menu",
            "Delete button on cards",
            "Status bar",
        ]);
        expect(isPage((group.items ?? []).slice(-1)[0])).toBe(true);
    });

    test("every stored key of the group is covered, on both kinds of device", () => {
        expect(coveredKeys(build().items)).toEqual(
            new Set([
                "reviewLook",
                "desktopLayout",
                "learnerName",
                "openViewInNewTab",
                "openViewInNewTabMobile",
                "flashcardHeightPercentage",
                "flashcardHeightPercentageMobile",
                "flashcardWidthPercentage",
                "flashcardWidthPercentageMobile",
                "showContextInCards",
                "initiallyExpandAllSubdecksInTree",
                "useCustomHotkeys",
                "showFileMenuReviewOptions",
                "showDeleteButtonInFileMenu",
                "showDeleteButtonInCardView",
                "showStatusBar",
                "showCardStatusBarItem",
                "showNoteStatusBarItem",
                "showUpdateAvailableStatusBarItem",
            ]),
        );
    });

    test("look offers Studio and Classic", () => {
        const row = findControl(build().items, "reviewLook");
        expect(row.name).toBe("Look");
        expect(row.desc).toBe("Studio is the full design; Classic keeps the plain look.");
        expect(row.aliases).toEqual(["theme", "style"]);
        expect(row.control).toMatchObject({ type: "dropdown" });
        expect(Object.entries((row.control as { options: object }).options)).toEqual([
            ["studio", "Studio"],
            ["classic", "Classic"],
        ]);
    });

    test("desktop layout is hidden on a phone and shown on a computer", () => {
        const onPhone = findControl(build(undefined, phone).items, "desktopLayout");
        expect(onPhone.name).toBe("Desktop layout");
        expect(onPhone.desc).toBe("Open Studio as a full tab with a sidebar and dashboard.");
        expect(onPhone.control).toMatchObject({ type: "toggle" });
        expect(typeof onPhone.visible).toBe("function");
        expect(truth(onPhone.visible)).toBe(false);

        const onComputer = findControl(build().items, "desktopLayout");
        expect(truth(onComputer.visible)).toBe(true);
    });

    test("desktop layout is off while the look is Classic, read when asked", () => {
        const { items, settings } = build();
        const disabled = disabledOf(findControl(items, "desktopLayout"));
        expect(typeof disabled).toBe("function");
        settings.reviewLook = "studio";
        expect(truth(disabled)).toBe(false);
        settings.reviewLook = "classic";
        expect(truth(disabled)).toBe(true);
        settings.reviewLook = "studio";
        expect(truth(disabled)).toBe(false);
    });

    test("your name is a plain text row", () => {
        const row = findControl(build().items, "learnerName");
        expect(row.name).toBe("Your name");
        expect(row.desc).toBe("Used in the greeting on the home screen.");
        expect(row.control).toMatchObject({ type: "text" });
        expect(row.control?.validate).toBeUndefined();
    });

    test("the simple toggles have their names, descriptions and aliases", () => {
        expectToggles(build().items, [
            [
                "openInTab",
                "Open in a tab",
                "Open the review in a tab instead of a pop-up window.",
                ["modal", "window"],
            ],
            [
                "showContextInCards",
                "Show where a card comes from",
                "The note title and headings above each card.",
                ["breadcrumb"],
            ],
            [
                "initiallyExpandAllSubdecksInTree",
                "Expand decks",
                "Deck lists start with every subdeck open.",
            ],
            ["showFileMenuReviewOptions", "Rate notes from the file menu", undefined],
            ["showDeleteButtonInFileMenu", "Delete schedules from the file menu", undefined],
            ["showDeleteButtonInCardView", "Delete button on cards", undefined],
        ]);
    });

    test.each([
        ["windowHeight", "Window height", "Size of the pop-up review window."],
        ["windowWidth", "Window width", undefined],
    ])("%s is a percent slider from 10 to 100", (key, name, desc) => {
        const row = findControl(build().items, key);
        expect(row.name).toBe(name);
        expect(row.desc).toBe(desc);
        expect(row.control).toMatchObject({ type: "slider", min: 10, max: 100, step: 5 });
        const format = (row.control as { displayFormat: (value: number) => string }).displayFormat;
        expect(format(60)).toBe("60%");
        expect(format(100)).toBe("100%");
    });

    describe("where the review opens", () => {
        // [device, openViewInNewTab, openViewInNewTabMobile, desktopLayout, reviewLook, opens in a tab]
        const cases: [string, boolean, boolean, boolean, "studio" | "classic", boolean][] = [
            ["computer, asked for a tab", true, false, false, "studio", true],
            ["computer, full tab layout", false, false, true, "studio", true],
            ["computer, pop-up", false, false, false, "studio", false],
            ["computer, Classic look with the layout on", false, false, true, "classic", false],
            ["computer, only the phone's tab setting on", false, true, false, "studio", false],
            ["phone, asked for a tab", false, true, true, "studio", true],
            ["phone, only the computer's tab setting on", true, false, true, "studio", false],
            ["phone, pop-up", false, false, true, "studio", false],
        ];

        function arranged(
            device: string,
            tab: boolean,
            tabMobile: boolean,
            layout: boolean,
            look: "studio" | "classic",
        ) {
            const settings = cloneDefaultSettings();
            settings.openViewInNewTab = tab;
            settings.openViewInNewTabMobile = tabMobile;
            settings.desktopLayout = layout;
            settings.reviewLook = look;
            return build(settings, device.startsWith("phone") ? phone : {});
        }

        test.each(cases)(
            "%s: the size rows are hidden and custom hotkeys on exactly when it opens in a tab",
            (device, tab, tabMobile, layout, look, inTab) => {
                const { items } = arranged(device, tab, tabMobile, layout, look);
                for (const key of ["windowHeight", "windowWidth"]) {
                    const row = findControl(items, key);
                    expect(typeof row.visible).toBe("function");
                    expect(truth(row.visible)).toBe(!inTab);
                }
                const hotkeys = findControl(items, "useCustomHotkeys");
                expect(typeof disabledOf(hotkeys)).toBe("function");
                expect(truth(disabledOf(hotkeys))).toBe(!inTab);
            },
        );

        test.each(cases)(
            "%s: Open in a tab is hidden exactly while the desktop layout already opens the review as a tab",
            (device, tab, tabMobile, layout, look) => {
                const { items } = arranged(device, tab, tabMobile, layout, look);
                const row = findControl(items, "openInTab");
                expect(typeof row.visible).toBe("function");
                const layoutOpensTab = !device.startsWith("phone") && layout && look !== "classic";
                expect(truth(row.visible)).toBe(!layoutOpensTab);
            },
        );

        test("Open in a tab comes and goes with the desktop layout and the look as they change", () => {
            const { items, settings } = arranged("computer", false, false, false, "studio");
            const row = findControl(items, "openInTab");
            expect(truth(row.visible)).toBe(true);
            settings.desktopLayout = true;
            expect(truth(row.visible)).toBe(false);
            settings.reviewLook = "classic";
            expect(truth(row.visible)).toBe(true);
            settings.reviewLook = "studio";
            expect(truth(row.visible)).toBe(false);
            settings.desktopLayout = false;
            expect(truth(row.visible)).toBe(true);
        });

        test("the rows follow the settings as they change after the group was built", () => {
            const { items, settings } = arranged("computer", false, false, false, "studio");
            const height = findControl(items, "windowHeight");
            const hotkeys = disabledOf(findControl(items, "useCustomHotkeys"));
            expect(truth(height.visible)).toBe(true);
            expect(truth(hotkeys)).toBe(true);
            settings.openViewInNewTab = true;
            expect(truth(height.visible)).toBe(false);
            expect(truth(hotkeys)).toBe(false);
            settings.openViewInNewTab = false;
            settings.desktopLayout = true;
            expect(truth(height.visible)).toBe(false);
            expect(truth(hotkeys)).toBe(false);
            settings.reviewLook = "classic";
            expect(truth(height.visible)).toBe(true);
            expect(truth(hotkeys)).toBe(true);
        });
    });

    test("custom hotkeys says where they apply and answers to shortcut", () => {
        const row = findControl(build().items, "useCustomHotkeys");
        expect(row.name).toBe("Custom hotkeys");
        expect(row.desc).toBe(
            "Answer with your own hotkeys from Obsidian's hotkey list instead of the number keys.",
        );
        expect(row.aliases).toEqual(["shortcut"]);
        expect(row.control).toMatchObject({ type: "toggle" });
    });

    describe("the Status bar page", () => {
        function page() {
            const built = build();
            const statusPage = (built.group.items ?? []).filter(isPage)[0];
            return { ...built, statusPage };
        }

        test("it is a page named Status bar with one headless group of four rows", () => {
            const { statusPage } = page();
            expect(statusPage.name).toBe("Status bar");
            expect(statusPage.visible).toBeUndefined();
            expect(statusPage.items).toHaveLength(1);
            const inner = statusPage.items?.[0] as SettingDefinitionGroup;
            expect(inner.type).toBe("group");
            expect(inner.heading).toBeUndefined();
            expect(inner.items?.map((row) => (row as { name: string }).name)).toEqual([
                "Status bar items",
                "Due cards",
                "Due notes",
                "Update notice",
            ]);
        });

        test("its entry says On or Off as the status bar setting is now", () => {
            const { statusPage, settings } = page();
            expect(typeof statusPage.displayValue).toBe("function");
            const show = () => (statusPage.displayValue as () => string)();
            settings.showStatusBar = true;
            expect(show()).toBe("On");
            settings.showStatusBar = false;
            expect(show()).toBe("Off");
            settings.showStatusBar = true;
            expect(show()).toBe("On");
        });

        test("the rows have their names and descriptions", () => {
            const { items } = page();
            expectToggles(items, [
                [
                    "showStatusBar",
                    "Status bar items",
                    "Show the plugin's counters in the status bar.",
                ],
                ["showCardStatusBarItem", "Due cards", undefined],
                ["showNoteStatusBarItem", "Due notes", undefined],
                [
                    "showUpdateAvailableStatusBarItem",
                    "Update notice",
                    "Checks GitHub for a newer release.",
                ],
            ]);
        });

        test("the three item rows are off while the status bar is off, and the switch never is", () => {
            const { items, settings } = page();
            expect(disabledOf(findControl(items, "showStatusBar"))).toBeUndefined();
            for (const key of [
                "showCardStatusBarItem",
                "showNoteStatusBarItem",
                "showUpdateAvailableStatusBarItem",
            ]) {
                const disabled = disabledOf(findControl(items, key));
                expect(typeof disabled).toBe("function");
                settings.showStatusBar = true;
                expect(truth(disabled)).toBe(false);
                settings.showStatusBar = false;
                expect(truth(disabled)).toBe(true);
            }
        });
    });
});

describe("reminders", () => {
    const options = [
        "reviewReminderIntervalMinutes",
        "reviewReminderCheckOnStartup",
        "reviewReminderMessage",
        "reviewReminderAutoOpen",
        "reviewReminderShowNotice",
        "reviewReminderPlaySound",
        "reviewReminderBounceDock",
    ];

    function build(overrides = {}) {
        const fake = fakeContext(undefined, overrides);
        const items = remindersGroup(fake.ctx);
        return { ...fake, items, ...onlyGroup(items) };
    }

    test("it is one group headed Reminders with eight rows in order", () => {
        const { group, names } = build();
        expect(group.heading).toBe("Reminders");
        expect(names).toEqual([
            "Review reminders",
            "Check every (minutes)",
            "Check at startup",
            "Reminder text",
            "Open the review",
            "Show a notice",
            "Play a sound",
            "Bounce the dock icon",
        ]);
    });

    test("every stored key of the group is covered", () => {
        expect(coveredKeys(build().items)).toEqual(new Set(["enableReviewReminders", ...options]));
    });

    test("the switch is a toggle that is never disabled", () => {
        const row = findControl(build().items, "enableReviewReminders");
        expect(row.name).toBe("Review reminders");
        expect(row.desc).toBe("Check for due cards now and then, and remind you.");
        expect(row.control).toMatchObject({ type: "toggle" });
        expect(disabledOf(row)).toBeUndefined();
    });

    test("every option is disabled exactly while reminders are off, read when asked", () => {
        const { items, settings } = build();
        for (const key of options) {
            const disabled = disabledOf(findControl(items, key));
            expect(typeof disabled).toBe("function");
            settings.enableReviewReminders = false;
            expect(truth(disabled)).toBe(true);
            settings.enableReviewReminders = true;
            expect(truth(disabled)).toBe(false);
            settings.enableReviewReminders = false;
            expect(truth(disabled)).toBe(true);
        }
    });

    test("the interval is a whole number of minutes from 1 to 1440", () => {
        const row = findControl(build().items, "reviewReminderIntervalMinutes");
        expect(row.name).toBe("Check every (minutes)");
        expect(row.desc).toBeUndefined();
        expect(row.control).toMatchObject({ type: "number", min: 1, max: 1440 });
        const validate = validateOf(row);
        expect(validate(0 as never)).toBe("Use a number from 1 to 1440.");
        expect(validate(1441 as never)).toBe("Use a number from 1 to 1440.");
        expect(validate(2.5 as never)).toBe("Use a whole number.");
        expect(validate(5 as never)).toBeUndefined();
    });

    test("the other options have their names and descriptions", () => {
        const { items } = build();
        expectToggles(items, [
            ["reviewReminderCheckOnStartup", "Check at startup", undefined],
            ["reviewReminderAutoOpen", "Open the review", undefined],
            ["reviewReminderShowNotice", "Show a notice", undefined],
            ["reviewReminderPlaySound", "Play a sound", undefined],
            ["reviewReminderBounceDock", "Bounce the dock icon", undefined],
        ]);
        const message = findControl(items, "reviewReminderMessage");
        expect(message.name).toBe("Reminder text");
        expect(message.desc).toBe("Empty uses the built-in message.");
        expect(message.control).toMatchObject({ type: "text" });
    });

    test("the sound and dock rows are hidden on a phone and shown on a computer", () => {
        const onPhone = build(phone).items;
        const onComputer = build().items;
        for (const key of ["reviewReminderPlaySound", "reviewReminderBounceDock"]) {
            const hidden = findControl(onPhone, key);
            expect(typeof hidden.visible).toBe("function");
            expect(truth(hidden.visible)).toBe(false);
            expect(truth(findControl(onComputer, key).visible)).toBe(true);
        }
    });

    test("the other rows are shown on a phone", () => {
        const items = build(phone).items;
        for (const key of options.filter((key) => !/PlaySound|BounceDock/.test(key))) {
            expect(truth(findControl(items, key).visible)).not.toBe(false);
        }
    });
});

describe("AI cards", () => {
    function build(provider = DEFAULT_SETTINGS.aiProvider) {
        const settings = cloneDefaultSettings();
        settings.aiProvider = provider;
        const fake = fakeContext(settings);
        const items = aiGroup(fake.ctx);
        return { ...fake, items, ...onlyGroup(items) };
    }

    test("it is one group headed AI cards with five rows in order", () => {
        const { group, names } = build();
        expect(group.heading).toBe("AI cards");
        expect(names).toEqual(["Provider", "Model", "Server address", "API key", "Privacy"]);
    });

    test("every stored key of the group is covered, the key through its render row", () => {
        expect(coveredKeys(build().items)).toEqual(
            new Set(["aiProvider", "aiModel", "aiBaseUrl", "aiKeySecret"]),
        );
    });

    test("provider offers the three kinds", () => {
        const row = findControl(build().items, "aiProvider");
        expect(row.name).toBe("Provider");
        expect(row.control).toMatchObject({ type: "dropdown" });
        expect(Object.entries((row.control as { options: object }).options)).toEqual([
            ["anthropic", "Anthropic"],
            ["openai", "OpenAI"],
            ["openai-compatible", "Compatible server (such as Ollama)"],
        ]);
    });

    test.each([
        ["anthropic", DEFAULT_SETTINGS.aiModel],
        ["openai", "gpt-5.1"],
        ["openai-compatible", "llama3.2"],
    ] as const)("the model placeholder for %s is %s", (provider, placeholder) => {
        const row = findControl(build(provider).items, "aiModel");
        expect(row.name).toBe("Model");
        expect(row.desc).toBe("The exact model name.");
        expect(row.control).toMatchObject({ type: "text", placeholder });
    });

    test("the Anthropic placeholder is the default model, not a copy of it", () => {
        const row = findControl(build("anthropic").items, "aiModel");
        expect((row.control as { placeholder?: string }).placeholder).toBe(
            DEFAULT_SETTINGS.aiModel,
        );
    });

    test("the server address is shown only for a compatible server, read when asked", () => {
        const { items, settings } = build();
        const row = findControl(items, "aiBaseUrl");
        expect(row.name).toBe("Server address");
        expect(row.desc).toBe("Up to, but not including, /chat/completions.");
        expect(row.control).toMatchObject({
            type: "text",
            placeholder: "http://localhost:11434/v1",
        });
        expect(typeof row.visible).toBe("function");
        settings.aiProvider = "anthropic";
        expect(truth(row.visible)).toBe(false);
        settings.aiProvider = "openai";
        expect(truth(row.visible)).toBe(false);
        settings.aiProvider = "openai-compatible";
        expect(truth(row.visible)).toBe(true);
    });

    test("the server address must start with http:// or https:// when given", () => {
        const validate = validateOf(findControl(build().items, "aiBaseUrl"));
        expect(validate("localhost:11434" as never)).toBe("Start with http:// or https://.");
        expect(validate("http://localhost:11434/v1" as never)).toBeUndefined();
        expect(validate("https://example.com/v1" as never)).toBeUndefined();
        expect(validate("" as never)).toBeUndefined();
    });

    describe("the API key row", () => {
        /** A row that records the component it was asked to add, standing in for Obsidian's. */
        function render() {
            const built = build();
            built.settings.aiKeySecret = "my-key";
            const row = findRow(built.items, "API key") as unknown as {
                desc: string;
                control?: unknown;
                render: (setting: Setting, group: SettingGroup) => void | (() => void);
            };
            const el = {} as HTMLElement;
            interface Added {
                app: unknown;
                containerEl: unknown;
                value: string;
                changed?: (value: string) => unknown;
            }
            const added: Added[] = [];
            const setting = {
                addComponent: (make: (el: HTMLElement) => Added) => {
                    added.push(make(el));
                    return setting;
                },
            };
            row.render(setting as unknown as Setting, {} as SettingGroup);
            expect(added).toHaveLength(1);
            return { ...built, row, el, component: added[0] };
        }

        test("it says where the key lives and has no control of its own", () => {
            const { row } = render();
            expect(row.desc).toBe(
                "Pick or add a key in Obsidian's secret storage. A local server usually needs none.",
            );
            expect(row.control).toBeUndefined();
        });

        test("it adds a secret component for the app, showing the stored secret name", () => {
            const { ctx, el, component } = render();
            expect(component.app).toBe(ctx.app);
            expect(component.containerEl).toBe(el);
            expect(component.value).toBe("my-key");
        });

        test("choosing a secret stores its name and saves", async () => {
            const { component, settings, mocks } = render();
            await component.changed?.("other-key");
            expect(settings.aiKeySecret).toBe("other-key");
            expect(mocks.commit).toHaveBeenCalledWith(["aiKeySecret"]);
        });
    });

    test("privacy is a row with a name and description and nothing to change", () => {
        const row = findRow(build().items, "Privacy");
        expect(row).toEqual({
            name: "Privacy",
            desc: "A note's text is sent to the provider only when you run the command to make cards.",
        });
    });
});
