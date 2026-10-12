import type {
    ExtraButtonComponent,
    SettingDefinition,
    SettingDefinitionAction,
    SettingDefinitionGroup,
    SettingDefinitionList,
    SettingDefinitionPage,
} from "obsidian";

import { CardRegionsModal } from "src/settings/card-regions-modal";
import { cardFormatsGroup } from "src/settings/definitions/card-formats";
import { coveredKeys } from "src/settings/definitions/helpers";
import { freshInstallSettings } from "src/settings/fresh-defaults";
import { TextPromptModal, TextPromptOptions } from "src/settings/text-prompt-modal";

import { fakeContext } from "../helpers/fake-settings-context";

jest.mock("src/settings/text-prompt-modal", () => ({
    TextPromptModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));
jest.mock("src/settings/card-regions-modal", () => ({
    CardRegionsModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

type Validate = (value: string) => string | undefined;
type OnSave = (start: string, end: string) => Promise<void>;

const promptMock = TextPromptModal as unknown as jest.Mock<
    { open: jest.Mock },
    [unknown, TextPromptOptions]
>;
const regionsMock = CardRegionsModal as unknown as jest.Mock<
    { open: jest.Mock },
    [unknown, string, string, OnSave]
>;
const anElement = {} as HTMLElement;

function clozePatternsPage(group: SettingDefinitionGroup) {
    return (group.items ?? []).find(
        (item) => "type" in item && item.type === "page" && item.name === "Cloze patterns",
    ) as SettingDefinitionPage;
}

function build(prepare?: (settings: ReturnType<typeof fakeContext>["settings"]) => void) {
    const fake = fakeContext();
    prepare?.(fake.settings);
    const items = cardFormatsGroup(fake.ctx);
    const group = items[0] as SettingDefinitionGroup;
    const page = clozePatternsPage(group);
    const list = (page.items ?? [])[0] as SettingDefinitionList;
    const row = (name: string) =>
        (group.items ?? []).find(
            (item) => "name" in item && item.name === name,
        ) as SettingDefinition;
    const validate = (name: string) => row(name).control?.validate as Validate;
    return { ...fake, items, group, page, list, row, validate };
}

beforeEach(() => jest.clearAllMocks());

test("it is the Card formats group alone, with the cloze patterns as its last entry", () => {
    const { items, group } = build();
    expect(items).toHaveLength(1);
    expect(group.type).toBe("group");
    expect(group.heading).toBe("Card formats");
});

test("the rows come in this order", () => {
    const { group } = build();
    expect((group.items ?? []).map((item) => (item as SettingDefinition).name)).toEqual([
        "One-line separator",
        "Two-way one-line separator",
        "Multi-line separator",
        "Two-way multi-line separator",
        "Callout card types",
        "One line per cloze card",
        "Clozes in math",
        "Card regions",
        "Cloze patterns",
    ]);
});

describe("the four separators", () => {
    const SEPARATORS = [
        [
            "One-line separator",
            "singleLineCardSeparator",
            "Between question and answer on one line, as in Question::Answer. Cards written with the old separator stop working.",
        ],
        [
            "Two-way one-line separator",
            "singleLineReversedCardSeparator",
            "Same, but you're also asked the answer side.",
        ],
        [
            "Multi-line separator",
            "multilineCardSeparator",
            "A line with only this, between question and answer.",
        ],
        [
            "Two-way multi-line separator",
            "multilineReversedCardSeparator",
            "Same, but you're also asked the answer side.",
        ],
    ] as const;
    const KEYS = SEPARATORS.map(([, key]) => key);

    test.each(SEPARATORS)("%s is a text row with its description", (name, key, desc) => {
        const { row } = build();
        expect(row(name).desc).toBe(desc);
        expect(row(name).control).toMatchObject({ type: "text", key });
    });

    test.each(SEPARATORS)("%s rejects a blank", (name) => {
        const { validate } = build();
        expect(validate(name)("")).toBe("Can't be empty.");
        expect(validate(name)("   ")).toBe("Can't be empty.");
    });

    test.each(SEPARATORS)("%s rejects each of the other three, and only those", (name, key) => {
        const { validate, settings } = build();
        for (const other of KEYS) {
            const value = settings[other];
            expect(validate(name)(value)).toBe(
                other === key ? undefined : "Another card type already uses this.",
            );
        }
        expect(validate(name)("@@")).toBeUndefined();
    });

    test("it compares against the other separators as they are when typing, not when the tab was built", () => {
        const { validate, settings } = build();
        expect(validate("One-line separator")("!!")).toBeUndefined();
        settings.multilineReversedCardSeparator = "!!";
        expect(validate("One-line separator")("!!")).toBe("Another card type already uses this.");
        expect(validate("Two-way multi-line separator")("!!")).toBeUndefined();
    });

    test("the header button puts the four separators back after asking, and leaves the rest", async () => {
        const { group, settings, mocks } = build();
        expect(group.extraButtons).toHaveLength(1);

        let clicked: (() => void) | undefined;
        const button = {
            setIcon: () => button,
            setTooltip: () => button,
            onClick: (fn: () => void) => ((clicked = fn), button),
        };
        group.extraButtons?.[0](button as unknown as ExtraButtonComponent);

        settings.singleLineCardSeparator = "@@";
        settings.multilineReversedCardSeparator = "##";
        settings.clozePatterns = ["{{answer}}"];
        clicked?.();
        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(settings.singleLineCardSeparator).toBe("@@");

        await mocks.confirm.mock.calls[0][2]();
        const fresh = freshInstallSettings();
        expect(settings.singleLineCardSeparator).toBe(fresh.singleLineCardSeparator);
        expect(settings.multilineReversedCardSeparator).toBe(fresh.multilineReversedCardSeparator);
        expect(settings.clozePatterns).toEqual(["{{answer}}"]);
        expect(mocks.commit).toHaveBeenCalledWith([...KEYS]);
        expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    });
});

test("callout card types is a text row with no check, because empty turns callout cards off", () => {
    const { row } = build();
    const callouts = row("Callout card types");
    expect(callouts.desc).toBe(
        "Callouts of these types are cards: the title asks, the body answers. Empty turns them off.",
    );
    expect(callouts.aliases).toEqual(["callout"]);
    expect(callouts.control).toMatchObject({
        type: "text",
        key: "calloutCardTypes",
        placeholder: "flashcard, question, card",
    });
    expect(callouts.control?.validate).toBeUndefined();
});

describe("one line per cloze card", () => {
    test("it is a toggle with its description", () => {
        const { row } = build();
        const atomic = row("One line per cloze card");
        expect(atomic.desc).toBe("A cloze card shows only its own line, not the whole paragraph.");
        expect(atomic.aliases).toEqual(["cloze"]);
        expect(atomic.control).toMatchObject({ type: "toggle", key: "atomicClozes" });
    });

    test("it is off-limits exactly while a start marker is set, as the reader counts it, read when asked", () => {
        const { row, settings } = build();
        const disabled = row("One line per cloze card").control?.disabled as () => boolean;
        expect(disabled()).toBe(false);
        settings.multilineCardStartMarker = "+++";
        expect(disabled()).toBe(true);
        // The reader treats any text, spaces included, as a start marker, so it ignores this option then too.
        settings.multilineCardStartMarker = "   ";
        expect(disabled()).toBe(true);
        settings.multilineCardStartMarker = "";
        expect(disabled()).toBe(false);
    });

    test("an end marker alone leaves it on, because the reader still finds clozes everywhere", () => {
        const { row, settings } = build();
        const disabled = row("One line per cloze card").control?.disabled as () => boolean;
        settings.multilineCardEndMarker = "---";
        expect(disabled()).toBe(false);
    });
});

test("clozes in math is a toggle", () => {
    const { row } = build();
    const math = row("Clozes in math");
    expect(math.desc).toBe("Use \\cloze{answer} inside $…$ and $$…$$ math.");
    expect(math.aliases).toEqual(["latex", "mathjax"]);
    expect(math.control).toMatchObject({ type: "toggle", key: "latexClozes" });
});

describe("the card regions row", () => {
    const rowOf = (build_: ReturnType<typeof build>) =>
        build_.row("Card regions") as SettingDefinitionAction;

    test("it is an action row that says what it does", () => {
        const region = rowOf(build());
        expect(region.aliases).toEqual(["region", "marker"]);
        expect(region.control).toBeUndefined();
        expect(typeof region.action).toBe("function");
    });

    test("with no markers it says regions are off", () => {
        expect(rowOf(build()).desc).toBe("Off: cards are found anywhere in a note.");
    });

    test("with markers it names them", () => {
        const region = rowOf(
            build((settings) => {
                settings.multilineCardStartMarker = "+++";
                settings.multilineCardEndMarker = "---";
            }),
        );
        expect(region.desc).toBe("Multi-line and cloze cards are found only between +++ and ---.");
    });

    test("with the same marker for both, it opens and closes a region in turn", () => {
        const region = rowOf(
            build((settings) => {
                settings.multilineCardStartMarker = "+++";
                settings.multilineCardEndMarker = "+++";
            }),
        );
        expect(region.desc).toBe(
            "Multi-line and cloze cards are found only between pairs of +++ lines.",
        );
    });

    test("with only a start marker the region stays open to the end of the note", () => {
        const region = rowOf(
            build((settings) => {
                settings.multilineCardStartMarker = "+++";
            }),
        );
        expect(region.desc).toBe("Multi-line and cloze cards are found only after the first +++.");
    });

    test("an end marker alone opens no region, but it still ends multi-line and cloze cards", () => {
        const region = rowOf(
            build((settings) => {
                settings.multilineCardEndMarker = "---";
            }),
        );
        expect(region.desc).toBe("Multi-line and cloze cards end at a line with ---.");
    });

    test("a marker is set when it is not empty, spaces included, as the reader counts it", () => {
        const spaces = rowOf(
            build((settings) => {
                settings.multilineCardStartMarker = "  ";
            }),
        );
        expect(spaces.desc).toBe("Multi-line and cloze cards are found only after the first   .");
        const endSpaces = rowOf(
            build((settings) => {
                settings.multilineCardEndMarker = " ";
            }),
        );
        expect(endSpaces.desc).toBe("Multi-line and cloze cards end at a line with  .");
    });

    test("clicking opens the dialog with the markers as they are then", () => {
        const { ctx, settings, row } = build();
        settings.multilineCardStartMarker = "<<<";
        settings.multilineCardEndMarker = ">>>";
        (row("Card regions") as SettingDefinitionAction).action(anElement, 0);
        expect(regionsMock).toHaveBeenCalledTimes(1);
        const [app, start, end] = regionsMock.mock.calls[0];
        expect(app).toBe(ctx.app);
        expect(start).toBe("<<<");
        expect(end).toBe(">>>");
        const opened = regionsMock.mock.results[0] as jest.MockResultReturn<{ open: jest.Mock }>;
        expect(opened.value.open).toHaveBeenCalledTimes(1);
    });

    test("saving the dialog stores both markers, saves once and rebuilds", async () => {
        const { settings, row, mocks } = build();
        (row("Card regions") as SettingDefinitionAction).action(anElement, 0);
        await regionsMock.mock.calls[0][3]("+++", "---");
        expect(settings.multilineCardStartMarker).toBe("+++");
        expect(settings.multilineCardEndMarker).toBe("---");
        expect(mocks.commit).toHaveBeenCalledTimes(1);
        expect(mocks.commit).toHaveBeenCalledWith([
            "multilineCardStartMarker",
            "multilineCardEndMarker",
        ]);
        expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    });

    test("saving two empty markers turns regions off", async () => {
        const { settings, row } = build((s) => {
            s.multilineCardStartMarker = "+++";
            s.multilineCardEndMarker = "---";
        });
        (row("Card regions") as SettingDefinitionAction).action(anElement, 0);
        await regionsMock.mock.calls[0][3]("", "");
        expect(settings.multilineCardStartMarker).toBe("");
        expect(settings.multilineCardEndMarker).toBe("");
    });
});

describe("the cloze patterns page", () => {
    test("it is one entry that opens a page, with no second row of the same name", () => {
        const { group, page, list } = build();
        expect(page.type).toBe("page");
        expect(page.name).toBe("Cloze patterns");
        expect(page.desc).toBe(
            "Write answer where the hidden text goes, and hint where an optional hint goes.",
        );
        expect(page.items).toHaveLength(1);
        expect(list.type).toBe("list");
        expect(
            (group.items ?? []).filter((item) => "name" in item && item.name === "Cloze patterns"),
        ).toHaveLength(1);
    });

    test("the list inside has its own heading, so the page title is not repeated", () => {
        const { page, list } = build();
        expect(list.heading).toBe("Patterns");
        expect(list.heading).not.toBe(page.name);
    });

    test("it shows how many patterns there are, read when asked", () => {
        const { page, settings } = build();
        const shown = page.displayValue as () => string;
        settings.clozePatterns = [];
        expect(shown()).toBe("None");
        settings.clozePatterns = ["{{answer}}"];
        expect(shown()).toBe("1 pattern");
        settings.clozePatterns = ["{{answer}}", "==answer=="];
        expect(shown()).toBe("2 patterns");
    });
});

test("every stored key the group writes is covered, and the three old mirror keys are left alone", () => {
    const { items } = build();
    expect(coveredKeys(items)).toEqual(
        new Set([
            "singleLineCardSeparator",
            "singleLineReversedCardSeparator",
            "multilineCardSeparator",
            "multilineReversedCardSeparator",
            "calloutCardTypes",
            "atomicClozes",
            "latexClozes",
            "multilineCardStartMarker",
            "multilineCardEndMarker",
            "clozePatterns",
        ]),
    );
});

describe("the cloze patterns list", () => {
    test("shows one row per pattern, and says so when there are none", () => {
        const first = build();
        expect(first.list.emptyState).toBe("No cloze patterns: cloze cards are off.");
        expect(first.list.items).toEqual([
            { name: "==[123;;]answer[;;hint]==", searchable: false },
        ]);

        const fake = fakeContext();
        fake.settings.clozePatterns = [];
        const emptyPage = clozePatternsPage(
            cardFormatsGroup(fake.ctx)[0] as SettingDefinitionGroup,
        );
        expect((emptyPage.items?.[0] as SettingDefinitionList).items).toEqual([]);
    });

    test("deleting removes that pattern, saves and rebuilds", () => {
        const { settings, list, mocks } = build();
        settings.clozePatterns = ["a answer", "b answer", "c answer"];
        list.onDelete?.(0);
        expect(settings.clozePatterns).toEqual(["b answer", "c answer"]);
        expect(mocks.commit).toHaveBeenCalledWith(["clozePatterns"]);
        expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    });

    test("deleting the last pattern leaves none", () => {
        const { settings, list } = build();
        list.onDelete?.(0);
        expect(settings.clozePatterns).toEqual([]);
    });

    describe("a pattern stored twice", () => {
        test("shows once, and the stored list is left as it is", () => {
            const fake = fakeContext();
            fake.settings.clozePatterns = ["a answer", "b answer", "a answer"];
            const page = clozePatternsPage(cardFormatsGroup(fake.ctx)[0] as SettingDefinitionGroup);
            const list = page.items?.[0] as SettingDefinitionList;
            expect(list.items).toEqual([
                { name: "a answer", searchable: false },
                { name: "b answer", searchable: false },
            ]);
            expect(fake.settings.clozePatterns).toEqual(["a answer", "b answer", "a answer"]);
            expect((page.displayValue as () => string)()).toBe("2 patterns");
        });

        test("deleting a shown row removes that pattern, every copy of it, and no other", () => {
            const { settings, list, mocks } = build();
            settings.clozePatterns = ["a answer", "b answer", "a answer", "c answer"];
            // Shown as a, b, c: the third row is c
            list.onDelete?.(2);
            expect(settings.clozePatterns).toEqual(["a answer", "b answer", "a answer"]);
            list.onDelete?.(0);
            expect(settings.clozePatterns).toEqual(["b answer"]);
            expect(mocks.commit).toHaveBeenCalledTimes(2);
            expect(mocks.commit).toHaveBeenCalledWith(["clozePatterns"]);
            expect(mocks.rebuild).toHaveBeenCalledTimes(2);
        });
    });

    test("add pattern opens the prompt", () => {
        const { list } = build();
        expect(list.addItem?.name).toBe("Add pattern");
        list.addItem?.action(anElement);
        expect(promptMock).toHaveBeenCalledTimes(1);
        const options = promptMock.mock.calls[0][1];
        expect(options.title).toBe("Add a cloze pattern");
        expect(options.placeholder).toBe("{{[123;;]answer[;;hint]}}");
        const opened = promptMock.mock.results[0] as jest.MockResultReturn<{ open: jest.Mock }>;
        expect(opened.value.open).toHaveBeenCalledTimes(1);
    });

    test("the prompt wants the word answer and no repeats, as the list stands then", () => {
        const { settings, list } = build();
        list.addItem?.action(anElement);
        const { check } = promptMock.mock.calls[0][1];
        expect(check("")).toBe("Can't be empty.");
        expect(check("{{hidden}}")).toBe("A pattern needs the word answer where the answer goes.");
        expect(check("{{answer}}")).toBeUndefined();
        settings.clozePatterns.push("{{answer}}");
        expect(check("{{answer}}")).toBe("Already in the list.");
    });

    test("submitting adds the trimmed pattern, saves and rebuilds", async () => {
        const { settings, list, mocks } = build();
        list.addItem?.action(anElement);
        await promptMock.mock.calls[0][1].onSubmit("  {{answer}}  ");
        expect(settings.clozePatterns).toEqual(["==[123;;]answer[;;hint]==", "{{answer}}"]);
        expect(mocks.commit).toHaveBeenCalledWith(["clozePatterns"]);
        expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    });
});
