import type {
    SettingDefinition,
    SettingDefinitionAction,
    SettingDefinitionGroup,
    SettingDefinitionItem,
} from "obsidian";
import { Notice } from "obsidian";

import { DataStore } from "src/data/data-store/store";
import { importLegacySettings } from "src/data/legacy-settings-migration";
import {
    DISCUSSIONS_URL,
    DOCS_URL,
    ISSUES_URL,
    RELEASES_URL,
    REPOSITORY_URL,
} from "src/data/product";
import { cloneDefaultSettings, DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { importFromLegacyPlugin } from "src/settings/actions";
import type { StoredKey } from "src/settings/adapters";
import { dataGroup } from "src/settings/definitions/data";
import { coveredKeys } from "src/settings/definitions/helpers";
import { effectsFor } from "src/settings/effects";
import { freshInstallSettings } from "src/settings/fresh-defaults";
import type FlashcardStudioPlugin from "src/studio-plugin";

import { fakeContext } from "../helpers/fake-settings-context";

jest.mock("obsidian", () => ({
    ...jest.requireActual<Record<string, unknown>>("../support/obsidian"),
    Notice: jest.fn(),
}));
jest.mock("src/data/legacy-settings-migration", () => ({
    importLegacySettings: jest.fn(),
}));

const importMock = importLegacySettings as jest.MockedFunction<typeof importLegacySettings>;
const noticeMock = Notice as unknown as jest.Mock;

const flush = () => new Promise((resolve) => window.setTimeout(resolve, 0));

/** The stand-in for the vault-wide file modifier: every method resolves at once. */
function fakeFileModifier() {
    return {
        migrateCommentsToCallouts: jest.fn(() => Promise.resolve()),
        deleteAllSchedulingData: jest.fn((..._: unknown[]) => Promise.resolve()),
        deleteAllSchedulingDataInNotes: jest.fn((..._: unknown[]) => Promise.resolve()),
        deleteAllSchedulingDataInCards: jest.fn((..._: unknown[]) => Promise.resolve()),
    };
}

const realInstance = DataStore.instance;
let fileModifier: ReturnType<typeof fakeFileModifier>;

beforeEach(() => {
    jest.clearAllMocks();
    fileModifier = fakeFileModifier();
    DataStore.instance = { fileModifier } as unknown as typeof DataStore.instance;
});

afterEach(() => {
    DataStore.instance = realInstance;
});

const isGroup = (item: SettingDefinitionItem): item is SettingDefinitionGroup =>
    "type" in item && item.type === "group";

/** The groups a build returns, by heading. */
function groupsOf(items: SettingDefinitionItem[]): Record<string, SettingDefinitionGroup> {
    const byHeading: Record<string, SettingDefinitionGroup> = {};
    for (const item of items) {
        if (!isGroup(item) || item.heading === undefined) throw new Error("A group has no heading");
        byHeading[item.heading] = item;
    }
    return byHeading;
}

const rowsOf = (group: SettingDefinitionGroup) =>
    (group.items ?? []) as (SettingDefinition & { name: string })[];

const namesOf = (group: SettingDefinitionGroup) => rowsOf(group).map((row) => row.name);

function rowOf(group: SettingDefinitionGroup, name: string) {
    const row = rowsOf(group).find((candidate) => candidate.name === name);
    if (row === undefined) throw new Error("No row " + name);
    return row;
}

/** Clicks an action row, the way Obsidian does. */
function click(row: SettingDefinition) {
    (row as SettingDefinitionAction).action({} as HTMLElement, 0);
}

function build(settings: StudioSettings = cloneDefaultSettings(), plugin?: FlashcardStudioPlugin) {
    const fake = fakeContext(settings, plugin === undefined ? {} : { plugin });
    const items = dataGroup(fake.ctx);
    return { ...fake, items, groups: groupsOf(items) };
}

/** Clicks the row, then runs the callback it gave to the confirmation dialog. */
async function clickAndConfirm(
    built: ReturnType<typeof build>,
    group: string,
    name: string,
): Promise<void> {
    click(rowOf(built.groups[group], name));
    expect(built.mocks.confirm).toHaveBeenCalledTimes(1);
    await built.mocks.confirm.mock.calls[0][2]();
}

describe("the groups", () => {
    test("there are five, headed Data, Delete schedules, Reset, Developer and Help", () => {
        const { items } = build();
        expect(items.map((item) => (item as SettingDefinitionGroup).heading)).toEqual([
            "Data",
            "Delete schedules",
            "Reset",
            "Developer",
            "Help",
        ]);
    });

    test("no heading says settings", () => {
        const { groups } = build();
        expect(Object.keys(groups).filter((heading) => /settings/i.test(heading))).toEqual([]);
    });

    test("the rows of each group, in order", () => {
        const { groups } = build();
        expect(namesOf(groups["Data"])).toEqual([
            "Review log folder",
            "Schedule on the card's last line",
            "Hide schedules in a callout",
            "Move existing schedules into callouts",
            "Import from Spaced Repetition",
        ]);
        expect(namesOf(groups["Delete schedules"])).toEqual([
            "Also remove tags",
            "Delete all schedules",
            "Delete note schedules",
            "Delete card schedules",
        ]);
        expect(namesOf(groups["Reset"])).toEqual(["Reset all settings"]);
        expect(namesOf(groups["Developer"])).toEqual([
            "Log scheduling details",
            "Log parser details",
        ]);
        expect(namesOf(groups["Help"])).toEqual([
            "Documentation",
            "Report a problem",
            "Discussions",
            "Release notes",
        ]);
    });

    test("every stored key the groups write is covered, and only those", () => {
        expect(coveredKeys(build().items)).toEqual(
            new Set<StoredKey>([
                "reviewLogFolder",
                "cardCommentOnSameLine",
                "useCalloutsForSchedulingComments",
                "deleteTagsOnSchedulingDataDeletion",
                "showSchedulingDebugMessages",
                "showParserDebugMessages",
            ]),
        );
    });

    test("building touches neither the data store nor the plugin", () => {
        DataStore.instance = undefined;
        const plugin = new Proxy(
            {},
            {
                get: () => {
                    throw new Error("the plugin was touched");
                },
            },
        ) as FlashcardStudioPlugin;
        expect(() => build(cloneDefaultSettings(), plugin)).not.toThrow();
    });
});

describe("the data rows", () => {
    test("the review log folder is a folder control with the default as placeholder", () => {
        const row = rowOf(build().groups["Data"], "Review log folder");
        expect(row.desc).toBe(
            "Every answer is logged here, one file per device and month, so sync never clashes.",
        );
        expect(row.control).toEqual({
            type: "folder",
            key: "reviewLogFolder",
            placeholder: "Flashcard Studio/Review log",
        });
        expect(row.control?.type === "folder" && row.control.placeholder).toBe(
            DEFAULT_SETTINGS.reviewLogFolder,
        );
    });

    test("the two schedule toggles have their names and descriptions", () => {
        const data = build().groups["Data"];
        const sameLine = rowOf(data, "Schedule on the card's last line");
        expect(sameLine.desc).toBe("Keeps lists intact by writing the schedule on the same line.");
        expect(sameLine.control).toEqual({ type: "toggle", key: "cardCommentOnSameLine" });
        const callout = rowOf(data, "Hide schedules in a callout");
        expect(callout.desc).toBe("New schedules go inside a folded callout instead of a comment.");
        expect(callout.control).toEqual({
            type: "toggle",
            key: "useCalloutsForSchedulingComments",
        });
    });
});

describe("move existing schedules into callouts", () => {
    const NAME = "Move existing schedules into callouts";

    test("it is a plain action row", () => {
        const row = rowOf(build().groups["Data"], NAME);
        expect(row.desc).toBe("Rewrites every note in the vault. Back up first.");
        expect(typeof (row as SettingDefinitionAction).action).toBe("function");
        expect(row.control).toBeUndefined();
    });

    test("clicking asks first and changes nothing until confirmed", () => {
        const built = build();
        click(rowOf(built.groups["Data"], NAME));
        expect(built.mocks.confirm).toHaveBeenCalledWith(
            "Move all schedules into callouts?",
            "This rewrites every note in your vault that holds a schedule. Make a backup first.",
            expect.any(Function),
        );
        expect(fileModifier.migrateCommentsToCallouts).not.toHaveBeenCalled();
        expect(noticeMock).not.toHaveBeenCalled();
    });

    test("confirming moves the schedules, then says so", async () => {
        const order: string[] = [];
        fileModifier.migrateCommentsToCallouts.mockImplementation(async () => {
            order.push("moved");
        });
        noticeMock.mockImplementation(() => order.push("notice"));
        const built = build();
        await clickAndConfirm(built, "Data", NAME);
        expect(fileModifier.migrateCommentsToCallouts).toHaveBeenCalledTimes(1);
        expect(noticeMock).toHaveBeenCalledTimes(1);
        expect(noticeMock).toHaveBeenCalledWith("Schedules moved.");
        expect(order).toEqual(["moved", "notice"]);
        expect(built.mocks.commit).not.toHaveBeenCalled();
    });

    test("it counts the schedules that stayed where they were, in a table or a list", async () => {
        fileModifier.migrateCommentsToCallouts.mockResolvedValue(3 as never);
        const built = build();
        await clickAndConfirm(built, "Data", NAME);
        expect(noticeMock).toHaveBeenCalledWith(
            "Schedules moved. 3 stayed where they were, in a table or a list.",
        );
    });
});

describe("import from Spaced Repetition", () => {
    const NAME = "Import from Spaced Repetition";
    const plugin = { name: "the plugin" } as unknown as FlashcardStudioPlugin;

    test("it asks first, and nothing happens until the question is confirmed", async () => {
        const built = build(cloneDefaultSettings(), plugin);
        const row = rowOf(built.groups["Data"], NAME);
        expect(row.desc).toBe("Copy settings from the Spaced Repetition plugin in this vault.");
        expect(typeof (row as SettingDefinitionAction).action).toBe("function");
        importMock.mockResolvedValue(3);

        click(row);
        await flush();
        expect(built.mocks.confirm).toHaveBeenCalledTimes(1);
        expect(built.mocks.confirm.mock.calls[0].slice(0, 2)).toEqual([
            "Import from Spaced Repetition?",
            "Your options are replaced by its settings, including the algorithm. This can't be undone.",
        ]);
        expect(importMock).not.toHaveBeenCalled();
        expect(built.mocks.commit).not.toHaveBeenCalled();
        expect(built.mocks.rebuild).not.toHaveBeenCalled();

        await built.mocks.confirm.mock.calls[0][2]();
        expect(importMock).toHaveBeenCalledTimes(1);
        expect(importMock).toHaveBeenCalledWith(plugin);
        expect(built.mocks.commit).toHaveBeenCalledTimes(1);
    });

    test("it is not tied to any stored key", () => {
        expect(coveredKeys(build().items).has("algorithm")).toBe(false);
    });

    test("imported settings are applied and the tab is redrawn, in that order", async () => {
        const order: string[] = [];
        const settings = cloneDefaultSettings();
        const built = build(settings, plugin);
        importMock.mockImplementation(() => {
            order.push("import");
            return Promise.resolve(3);
        });
        built.mocks.commit.mockImplementation(() => {
            order.push("commit");
            return Promise.resolve();
        });
        built.mocks.rebuild.mockImplementation(() => order.push("rebuild"));

        await clickAndConfirm(built, "Data", NAME);

        expect(importMock).toHaveBeenCalledTimes(1);
        expect(importMock).toHaveBeenCalledWith(plugin);
        expect(order).toEqual(["import", "commit", "rebuild"]);
        expect(built.mocks.commit).toHaveBeenCalledTimes(1);
        expect(built.mocks.rebuild).toHaveBeenCalledTimes(1);
    });

    test("every effect is applied again: all stored keys are committed", async () => {
        const settings = cloneDefaultSettings();
        const built = build(settings, plugin);
        importMock.mockResolvedValue(3);
        await clickAndConfirm(built, "Data", NAME);

        const committed = built.mocks.commit.mock.calls[0][0];
        const expected = Object.keys(settings).filter((key) => key !== "aiProvider");
        expect(committed).toEqual(expected);
        for (const key of ["algorithm", "showStatusBar", "startOfDay", "useCustomHotkeys"]) {
            expect(committed).toContain(key);
        }
    });

    test("the AI provider is left out, because committing it would wipe the chosen model", async () => {
        const built = build(cloneDefaultSettings(), plugin);
        importMock.mockResolvedValue(1);
        await clickAndConfirm(built, "Data", NAME);
        const committed = built.mocks.commit.mock.calls[0][0];
        expect(committed).not.toContain("aiProvider");
        expect(effectsFor(committed)).not.toContain("aiModel");
        expect(effectsFor(committed)).toContain("rebuildScheduler");
    });

    test("an import that throws says so, commits and redraws nothing, and the promise still resolves", async () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const built = build(cloneDefaultSettings(), plugin);
        importMock.mockRejectedValue(new Error("disk full"));

        await expect(importFromLegacyPlugin(built.ctx)).resolves.toBeUndefined();

        expect(noticeMock).toHaveBeenCalledTimes(1);
        expect(noticeMock).toHaveBeenCalledWith("Couldn't finish: disk full");
        expect(errorSpy).toHaveBeenCalled();
        expect(built.mocks.commit).not.toHaveBeenCalled();
        expect(built.mocks.rebuild).not.toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    test("clicking the row when the import throws leaves nothing unhandled", async () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const built = build(cloneDefaultSettings(), plugin);
        importMock.mockRejectedValue(new Error("unreadable"));
        await clickAndConfirm(built, "Data", NAME);
        expect(noticeMock).toHaveBeenCalledWith("Couldn't finish: unreadable");
        expect(built.mocks.commit).not.toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    test("when there was nothing to import it neither commits nor redraws", async () => {
        const built = build(cloneDefaultSettings(), plugin);
        importMock.mockResolvedValue(null);
        await clickAndConfirm(built, "Data", NAME);
        expect(importMock).toHaveBeenCalledTimes(1);
        expect(built.mocks.commit).not.toHaveBeenCalled();
        expect(built.mocks.rebuild).not.toHaveBeenCalled();
    });
});

describe("delete schedules", () => {
    const BODY = "This can't be undone. Back up your vault first.";

    function buildWithTags(deleteTags: boolean) {
        const settings = cloneDefaultSettings();
        settings.deleteTagsOnSchedulingDataDeletion = deleteTags;
        settings.flashcardTags = ["#cards", "#deck"];
        settings.tagsToReview = ["#review", "#later"];
        return build(settings);
    }

    test("also remove tags is a toggle", () => {
        const row = rowOf(build().groups["Delete schedules"], "Also remove tags");
        expect(row.desc).toBe("Remove the flashcard and review tags along with the schedules.");
        expect(row.control).toEqual({ type: "toggle", key: "deleteTagsOnSchedulingDataDeletion" });
    });

    test.each([
        ["Delete all schedules", "Delete all schedules?"],
        ["Delete note schedules", "Delete note schedules?"],
        ["Delete card schedules", "Delete card schedules?"],
    ])("%s asks first, and deletes nothing until confirmed", (name, title) => {
        const built = buildWithTags(true);
        const row = rowOf(built.groups["Delete schedules"], name);
        expect(typeof (row as SettingDefinitionAction).action).toBe("function");
        click(row);
        expect(built.mocks.confirm).toHaveBeenCalledWith(title, BODY, expect.any(Function));
        expect(fileModifier.deleteAllSchedulingData).not.toHaveBeenCalled();
        expect(fileModifier.deleteAllSchedulingDataInNotes).not.toHaveBeenCalled();
        expect(fileModifier.deleteAllSchedulingDataInCards).not.toHaveBeenCalled();
    });

    test("delete all schedules passes the card tags, then the note tags", async () => {
        const built = buildWithTags(true);
        await clickAndConfirm(built, "Delete schedules", "Delete all schedules");
        expect(fileModifier.deleteAllSchedulingData).toHaveBeenCalledTimes(1);
        expect(fileModifier.deleteAllSchedulingData).toHaveBeenCalledWith(
            true,
            ["#cards", "#deck"],
            ["#review", "#later"],
        );
        expect(fileModifier.deleteAllSchedulingDataInNotes).not.toHaveBeenCalled();
        expect(fileModifier.deleteAllSchedulingDataInCards).not.toHaveBeenCalled();
    });

    test("delete note schedules passes the review tags", async () => {
        const built = buildWithTags(true);
        await clickAndConfirm(built, "Delete schedules", "Delete note schedules");
        expect(fileModifier.deleteAllSchedulingDataInNotes).toHaveBeenCalledTimes(1);
        expect(fileModifier.deleteAllSchedulingDataInNotes).toHaveBeenCalledWith(true, [
            "#review",
            "#later",
        ]);
        expect(fileModifier.deleteAllSchedulingData).not.toHaveBeenCalled();
        expect(fileModifier.deleteAllSchedulingDataInCards).not.toHaveBeenCalled();
    });

    test("delete card schedules passes the flashcard tags", async () => {
        const built = buildWithTags(false);
        await clickAndConfirm(built, "Delete schedules", "Delete card schedules");
        expect(fileModifier.deleteAllSchedulingDataInCards).toHaveBeenCalledTimes(1);
        expect(fileModifier.deleteAllSchedulingDataInCards).toHaveBeenCalledWith(false, [
            "#cards",
            "#deck",
        ]);
        expect(fileModifier.deleteAllSchedulingData).not.toHaveBeenCalled();
        expect(fileModifier.deleteAllSchedulingDataInNotes).not.toHaveBeenCalled();
    });

    test("the toggle and the tags are read when confirmed, not when the tab was built", async () => {
        const built = buildWithTags(false);
        click(rowOf(built.groups["Delete schedules"], "Delete all schedules"));
        built.settings.deleteTagsOnSchedulingDataDeletion = true;
        built.settings.flashcardTags = ["#new-cards"];
        built.settings.tagsToReview = ["#new-review"];
        await built.mocks.confirm.mock.calls[0][2]();
        expect(fileModifier.deleteAllSchedulingData).toHaveBeenCalledWith(
            true,
            ["#new-cards"],
            ["#new-review"],
        );
    });

    test("the file modifier says it is done, so no second notice appears", async () => {
        const built = buildWithTags(true);
        await clickAndConfirm(built, "Delete schedules", "Delete all schedules");
        expect(noticeMock).not.toHaveBeenCalled();
        expect(built.mocks.commit).not.toHaveBeenCalled();
    });
});

describe("reset all settings", () => {
    const NAME = "Reset all settings";

    /** A settings object that differs from a new install in several ways, and the data around it. */
    function changedSettings() {
        const settings = cloneDefaultSettings();
        settings.algorithm = SchedulerKind.SM2;
        settings.answerKeys = "original";
        settings.fsrsEnableFuzz = false;
        settings.newCardsPerDay = 99;
        settings.flashcardTags = ["#mine"];
        settings.learnerName = "Ed";
        return settings;
    }

    test("it is an action row that asks first", () => {
        const built = build();
        const row = rowOf(built.groups["Reset"], NAME);
        expect(row.desc).toBe(
            "Go back to how a new install starts. Your cards and schedules stay.",
        );
        click(row);
        expect(built.mocks.confirm).toHaveBeenCalledWith(
            "Reset all settings?",
            "Every option goes back to how a new install starts. Your notes, cards and review history are not touched.",
            expect.any(Function),
        );
        expect(noticeMock).not.toHaveBeenCalled();
    });

    test("nothing changes until it is confirmed", () => {
        const settings = changedSettings();
        const built = build(settings);
        click(rowOf(built.groups["Reset"], NAME));
        expect(settings.newCardsPerDay).toBe(99);
        expect(built.mocks.commit).not.toHaveBeenCalled();
    });

    test("the same settings object is restored to a new install's values", async () => {
        const settings = changedSettings();
        const built = build(settings);
        await clickAndConfirm(built, "Reset", NAME);

        expect(built.ctx.settings).toBe(settings);
        const fresh = freshInstallSettings();
        expect(settings).toEqual(fresh);
        expect(settings.algorithm).toBe(SchedulerKind.FSRS);
        expect(settings.answerKeys).toBe("anki");
        expect(settings.fsrsEnableFuzz).toBe(true);
        expect(settings.newCardsPerDay).toBe(DEFAULT_SETTINGS.newCardsPerDay);
    });

    test("every changed key is committed, then the tab is redrawn, then the notice shows", async () => {
        const order: string[] = [];
        const settings = changedSettings();
        const built = build(settings);
        built.mocks.commit.mockImplementation(() => {
            order.push("commit");
            return Promise.resolve();
        });
        built.mocks.rebuild.mockImplementation(() => order.push("rebuild"));
        noticeMock.mockImplementation(() => order.push("notice"));

        await clickAndConfirm(built, "Reset", NAME);

        expect(built.mocks.commit).toHaveBeenCalledTimes(1);
        const committed = built.mocks.commit.mock.calls[0][0];
        for (const key of [
            "algorithm",
            "answerKeys",
            "fsrsEnableFuzz",
            "newCardsPerDay",
            "flashcardTags",
            "learnerName",
        ]) {
            expect(committed).toContain(key);
        }
        // A key that already matched a new install is not committed.
        expect(committed).not.toContain("showStatusBar");
        expect(noticeMock).toHaveBeenCalledWith("Settings reset.");
        expect(order).toEqual(["commit", "rebuild", "notice"]);
    });

    test("data kept next to the settings is untouched", async () => {
        const settings = changedSettings();
        const buryList = ["card-1", "card-2"];
        const pluginData = { settings, buryList };
        const built = build(pluginData.settings);

        await clickAndConfirm(built, "Reset", NAME);

        expect(pluginData.settings).toBe(settings);
        expect(pluginData.buryList).toBe(buryList);
        expect(pluginData.buryList).toEqual(["card-1", "card-2"]);
        expect(Object.keys(pluginData)).toEqual(["settings", "buryList"]);
    });

    test("a settings object that already is a new install commits nothing and still reports", async () => {
        const settings = freshInstallSettings();
        const built = build(settings);
        await clickAndConfirm(built, "Reset", NAME);
        expect(built.mocks.commit).toHaveBeenCalledWith([]);
        expect(noticeMock).toHaveBeenCalledWith("Settings reset.");
    });
});

describe("developer", () => {
    test("the two logging toggles", () => {
        const developer = build().groups["Developer"];
        const scheduling = rowOf(developer, "Log scheduling details");
        expect(scheduling.desc).toBe(
            "Writes extra details to the developer console after each scan.",
        );
        expect(scheduling.control).toEqual({ type: "toggle", key: "showSchedulingDebugMessages" });
        const parser = rowOf(developer, "Log parser details");
        expect(parser.desc).toBe("Writes how each note is read to the developer console.");
        expect(parser.control).toEqual({ type: "toggle", key: "showParserDebugMessages" });
    });
});

describe("help", () => {
    let open: jest.SpyInstance;

    beforeEach(() => {
        open = jest.spyOn(window, "open").mockImplementation(() => null);
    });

    afterEach(() => {
        open.mockRestore();
    });

    const LINKS: [string, string][] = [
        ["Documentation", DOCS_URL],
        ["Report a problem", ISSUES_URL],
        ["Discussions", DISCUSSIONS_URL],
        ["Release notes", RELEASES_URL],
    ];

    test("it has exactly four action rows and no controls", () => {
        const rows = rowsOf(build().groups["Help"]);
        expect(rows).toHaveLength(4);
        for (const row of rows) {
            expect(typeof (row as SettingDefinitionAction).action).toBe("function");
            expect(row.control).toBeUndefined();
        }
    });

    test.each(LINKS)("%s opens its own address", (name, url) => {
        click(rowOf(build().groups["Help"], name));
        expect(open).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledWith(url);
    });

    test("building the group opens nothing", () => {
        build();
        expect(open).not.toHaveBeenCalled();
    });

    test("every address belongs to the product's repository", () => {
        const help = build().groups["Help"];
        for (const [name] of LINKS) click(rowOf(help, name));
        expect(open).toHaveBeenCalledTimes(4);
        for (const [url] of open.mock.calls as [string][]) {
            expect(url.startsWith(REPOSITORY_URL)).toBe(true);
        }
    });
});
