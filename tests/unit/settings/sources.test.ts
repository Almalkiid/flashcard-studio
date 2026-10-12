import type {
    SettingDefinition,
    SettingDefinitionGroup,
    SettingDefinitionList,
    SettingDefinitionPage,
} from "obsidian";

import { coveredKeys } from "src/settings/definitions/helpers";
import { sourcesGroup } from "src/settings/definitions/sources";
import { TextPromptModal, TextPromptOptions } from "src/settings/text-prompt-modal";

import { fakeContext } from "../helpers/fake-settings-context";

jest.mock("src/settings/text-prompt-modal", () => ({
    TextPromptModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

function skippedFoldersPage(group: SettingDefinitionGroup) {
    return (group.items ?? []).find(
        (item) => "type" in item && item.type === "page" && item.name === "Skipped folders",
    ) as SettingDefinitionPage;
}

function build() {
    const fake = fakeContext();
    const items = sourcesGroup(fake.ctx);
    const group = items[0] as SettingDefinitionGroup;
    const page = skippedFoldersPage(group);
    const list = (page.items ?? [])[0] as SettingDefinitionList;
    const row = (name: string) =>
        (group.items ?? []).find(
            (item) => "name" in item && item.name === name,
        ) as SettingDefinition;
    return { ...fake, items, group, page, list, row };
}

const anElement = {} as HTMLElement;
const promptMock = TextPromptModal as unknown as jest.Mock<
    { open: jest.Mock },
    [unknown, TextPromptOptions]
>;

beforeEach(() => jest.clearAllMocks());

test("it is one headless group, with the skipped folders as its last entry", () => {
    const { items, group } = build();
    expect(items).toHaveLength(1);
    expect(group.type).toBe("group");
    expect(group.heading).toBeUndefined();
    expect((group.items ?? []).map((item) => (item as { name: string }).name)).toEqual([
        "Flashcard tags",
        "Use folders as decks",
        "Tags to skip",
        "Skipped folders",
    ]);
});

test("flashcard tags is a text row that rejects tags without a hash", () => {
    const { row } = build();
    const tags = row("Flashcard tags");
    expect(tags.desc).toBe(
        "Notes with any of these tags hold flashcards. Separate tags with spaces.",
    );
    expect(tags.aliases).toEqual(["tag", "deck"]);
    expect(tags.control).toMatchObject({
        type: "text",
        key: "flashcardTags",
        placeholder: "#flashcards",
    });
    const validate = tags.control?.validate as (value: string) => string | undefined;
    expect(validate("#flashcards #maths")).toBeUndefined();
    expect(validate("flashcards")).toBe("Tags start with #, such as #flashcards.");
});

test("tags to skip rejects tags without a hash too, because the control normalises what it stores", () => {
    const { row } = build();
    const skip = row("Tags to skip");
    expect(skip.desc).toBe("Notes with any of these tags never make flashcards.");
    expect(skip.aliases).toEqual(["ignore", "exclude"]);
    expect(skip.control).toMatchObject({ type: "text", key: "flashcardTagsToIgnore" });
    const validate = skip.control?.validate as (value: string) => string | undefined;
    expect(validate("#draft")).toBeUndefined();
    expect(validate("draft")).toBe("Tags start with #, such as #flashcards.");
});

test("use folders as decks is a toggle", () => {
    const { row } = build();
    const folders = row("Use folders as decks");
    expect(folders.desc).toBe("Each folder becomes a deck, instead of the tag.");
    expect(folders.aliases).toEqual(["folder"]);
    expect(folders.control).toMatchObject({ type: "toggle", key: "convertFoldersToDecks" });
});

describe("the skipped folders page", () => {
    test("it is one entry that opens a page, with no second row of the same name", () => {
        const { group, page, list } = build();
        expect(page.type).toBe("page");
        expect(page.name).toBe("Skipped folders");
        expect(page.desc).toBe(
            "Folders, or patterns such as **/*.excalidraw.md, that are never scanned for cards or notes.",
        );
        expect(page.items).toHaveLength(1);
        expect(list.type).toBe("list");
        expect(
            (group.items ?? []).filter((item) => "name" in item && item.name === "Skipped folders"),
        ).toHaveLength(1);
    });

    test("the list inside has its own heading, so the page title is not repeated", () => {
        const { page, list } = build();
        expect(list.heading).toBe("Folders and patterns");
        expect(list.heading).not.toBe(page.name);
    });

    test("it shows how many folders are skipped, read when asked", () => {
        const { page, settings } = build();
        const shown = page.displayValue as () => string;
        settings.noteFoldersToIgnore = [];
        expect(shown()).toBe("None");
        settings.noteFoldersToIgnore = ["Templates"];
        expect(shown()).toBe("1 folder");
        settings.noteFoldersToIgnore = ["Templates", "**/*.excalidraw.md"];
        expect(shown()).toBe("2 folders");
    });
});

test("every stored key of the group is covered", () => {
    const { items } = build();
    expect(coveredKeys(items)).toEqual(
        new Set([
            "flashcardTags",
            "convertFoldersToDecks",
            "flashcardTagsToIgnore",
            "noteFoldersToIgnore",
        ]),
    );
});

describe("the skipped folders list", () => {
    test("shows one row per entry, and says so when there are none", () => {
        const first = build();
        expect(first.list.emptyState).toBe("No folders are skipped.");
        expect(first.list.items).toEqual([{ name: "**/*.excalidraw.md", searchable: false }]);

        const fake = fakeContext();
        fake.settings.noteFoldersToIgnore = [];
        const emptyPage = skippedFoldersPage(sourcesGroup(fake.ctx)[0] as SettingDefinitionGroup);
        expect((emptyPage.items?.[0] as SettingDefinitionList).items).toEqual([]);
    });

    test("deleting removes that entry, saves and rebuilds", () => {
        const { settings, list, mocks } = build();
        settings.noteFoldersToIgnore = ["a", "b", "c"];
        list.onDelete?.(1);
        expect(settings.noteFoldersToIgnore).toEqual(["a", "c"]);
        expect(mocks.commit).toHaveBeenCalledWith(["noteFoldersToIgnore"]);
        expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    });

    test("delete works on the settings as they are when it is clicked, not when the tab was built", () => {
        const { settings, list } = build();
        settings.noteFoldersToIgnore = ["x", "y"];
        list.onDelete?.(0);
        expect(settings.noteFoldersToIgnore).toEqual(["y"]);
    });

    describe("a folder stored twice", () => {
        test("shows once, and the stored list is left as it is", () => {
            const fake = fakeContext();
            fake.settings.noteFoldersToIgnore = ["a", "b", "a"];
            const page = skippedFoldersPage(sourcesGroup(fake.ctx)[0] as SettingDefinitionGroup);
            const list = page.items?.[0] as SettingDefinitionList;
            expect(list.items).toEqual([
                { name: "a", searchable: false },
                { name: "b", searchable: false },
            ]);
            expect(fake.settings.noteFoldersToIgnore).toEqual(["a", "b", "a"]);
            expect((page.displayValue as () => string)()).toBe("2 folders");
        });

        test("deleting a shown row removes that folder, every copy of it, and no other", () => {
            const { settings, list, mocks } = build();
            settings.noteFoldersToIgnore = ["a", "b", "a", "c"];
            // Shown as a, b, c: the third row is c
            list.onDelete?.(2);
            expect(settings.noteFoldersToIgnore).toEqual(["a", "b", "a"]);
            list.onDelete?.(0);
            expect(settings.noteFoldersToIgnore).toEqual(["b"]);
            expect(mocks.commit).toHaveBeenCalledTimes(2);
            expect(mocks.commit).toHaveBeenCalledWith(["noteFoldersToIgnore"]);
            expect(mocks.rebuild).toHaveBeenCalledTimes(2);
        });
    });

    describe("entries that start with !, saved by an earlier version", () => {
        const WARNING = "Starts with !: skips every other folder";

        test("stay as they were saved, flagged on their row so they can be deleted", () => {
            const fake = fakeContext();
            fake.settings.noteFoldersToIgnore = ["Templates", "!Archive/**", "x!y", "!Archive/**"];
            const page = skippedFoldersPage(sourcesGroup(fake.ctx)[0] as SettingDefinitionGroup);
            const list = page.items?.[0] as SettingDefinitionList;
            expect(list.items).toEqual([
                { name: "Templates", searchable: false },
                { name: "!Archive/**", desc: WARNING, searchable: false },
                { name: "x!y", searchable: false },
            ]);
            expect(fake.settings.noteFoldersToIgnore).toEqual([
                "Templates",
                "!Archive/**",
                "x!y",
                "!Archive/**",
            ]);
            expect(fake.mocks.commit).not.toHaveBeenCalled();
        });

        test("deleting a flagged row removes the entry", () => {
            const { settings, list, mocks } = build();
            settings.noteFoldersToIgnore = ["a", "!b", "c"];
            list.onDelete?.(1);
            expect(settings.noteFoldersToIgnore).toEqual(["a", "c"]);
            expect(mocks.commit).toHaveBeenCalledWith(["noteFoldersToIgnore"]);
        });

        test("make the page show a warning for as long as one is in the list, read when asked", () => {
            const { page, settings } = build();
            const status = page.status as () => "warning" | null;
            expect(status()).toBeNull();
            settings.noteFoldersToIgnore.push("!Archive");
            expect(status()).toBe("warning");
            settings.noteFoldersToIgnore = ["Archive", "x!y"];
            expect(status()).toBeNull();
        });
    });

    test("add folder opens the prompt", () => {
        const { list } = build();
        expect(list.addItem?.name).toBe("Add folder");
        list.addItem?.action(anElement);
        expect(promptMock).toHaveBeenCalledTimes(1);
        const options = promptMock.mock.calls[0][1];
        expect(options.title).toBe("Skip a folder");
        expect(options.placeholder).toBe("Templates or **/*.excalidraw.md");
        const opened = promptMock.mock.results[0] as jest.MockResultReturn<{ open: jest.Mock }>;
        expect(opened.value.open).toHaveBeenCalledTimes(1);
    });

    test("the prompt rejects blanks and entries already in the list, as the list stands then", () => {
        const { settings, list } = build();
        list.addItem?.action(anElement);
        const { check } = promptMock.mock.calls[0][1];
        expect(check("")).toBe("Can't be empty.");
        expect(check("Templates")).toBeUndefined();
        settings.noteFoldersToIgnore.push("Templates");
        expect(check(" Templates ")).toBe("Already in the list.");
    });

    test("the prompt refuses a pattern that starts with !, which would skip every other folder", () => {
        const { list } = build();
        list.addItem?.action(anElement);
        const { check } = promptMock.mock.calls[0][1];
        expect(check("!Templates/**")).toBe(
            "Patterns starting with ! would skip every other folder.",
        );
        expect(check(" !Templates ")).toBe(
            "Patterns starting with ! would skip every other folder.",
        );
        expect(check("Templates/!keep.md")).toBeUndefined();
    });

    test("submitting adds the trimmed entry, saves and rebuilds", async () => {
        const { settings, list, mocks } = build();
        list.addItem?.action(anElement);
        await promptMock.mock.calls[0][1].onSubmit("  Templates  ");
        expect(settings.noteFoldersToIgnore).toEqual(["**/*.excalidraw.md", "Templates"]);
        expect(mocks.commit).toHaveBeenCalledWith(["noteFoldersToIgnore"]);
        expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    });
});
