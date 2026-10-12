import type {
    App,
    ExtraButtonComponent,
    Setting,
    SettingDefinition,
    SettingDefinitionGroup,
    SettingDefinitionItem,
    SettingDefinitionPage,
    SettingGroup,
} from "obsidian";
import { Notice } from "obsidian";

import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import { MIN_REVIEWS_TO_OPTIMIZE } from "src/scheduling/optimizer/optimize";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { readControl, writeControl } from "src/settings/adapters";
import { coveredKeys } from "src/settings/definitions/helpers";
import { schedulingGroup, schedulingNotices } from "src/settings/definitions/scheduling";
import { freshInstallSettings } from "src/settings/fresh-defaults";
import type { StatsCard } from "src/stats/types";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { FsrsOptimizerModal } from "src/ui/obsidian-ui-components/modals/fsrs-optimizer-modal";
import { collectStatsCards, currentDayKeyFn } from "src/ui/statistics-view/stats-data";

import { fakeContext } from "../helpers/fake-settings-context";

jest.mock("src/ui/obsidian-ui-components/modals/fsrs-optimizer-modal", () => ({
    FsrsOptimizerModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

jest.mock("src/ui/statistics-view/stats-data", () => ({
    collectStatsCards: jest.fn(),
    currentDayKeyFn: jest.fn(),
}));

const collectMock = collectStatsCards as jest.MockedFunction<typeof collectStatsCards>;
const dayKeyMock = currentDayKeyFn as jest.MockedFunction<typeof currentDayKeyFn>;

const modalMock = FsrsOptimizerModal as unknown as jest.Mock<
    { open: jest.Mock },
    [App, FlashcardStudioPlugin, (weights: number[]) => Promise<void>]
>;

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

const app = { sentinel: "app" } as unknown as App;
const plugin = { sentinel: "plugin" } as unknown as FlashcardStudioPlugin;

function build(overrides: Parameters<typeof fakeContext>[1] = {}) {
    const fake = fakeContext(undefined, { app, plugin, ...overrides });
    const items = schedulingGroup(fake.ctx);
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

/** Runs the header button's click, as Obsidian would, and returns what the click did. */
function clickHeaderButton(group: SettingDefinitionGroup) {
    expect(group.extraButtons).toHaveLength(1);
    let clicked: (() => void) | undefined;
    const button = {
        setIcon: () => button,
        setTooltip: () => button,
        onClick: (fn: () => void) => ((clicked = fn), button),
    };
    group.extraButtons?.[0](button as unknown as ExtraButtonComponent);
    clicked?.();
}

beforeEach(() => jest.clearAllMocks());

describe("the group", () => {
    test("it is one group headed Scheduling, with rows in order and then three pages", () => {
        const { items, group } = build();
        expect(items).toHaveLength(1);
        expect(group.type).toBe("group");
        expect(group.heading).toBe("Scheduling");
        expect((group.items ?? []).map((item) => (item as { name: string }).name)).toEqual([
            "Algorithm",
            "Desired retention (%)",
            "Expected workload",
            "Optimize parameters",
            "Next day starts at",
            "Maximum interval (days)",
            "Advanced FSRS",
            "Easy days",
            "SM-2",
        ]);
        expect((group.items ?? []).slice(-3).every(isPage)).toBe(true);
    });

    test("every stored key of the group is covered", () => {
        const { items } = build();
        expect(coveredKeys(items)).toEqual(
            new Set([
                "algorithm",
                "fsrsDesiredRetention",
                "fsrsWeights",
                "startOfDay",
                "maximumInterval",
                "fsrsLearningSteps",
                "fsrsRelearningSteps",
                "fsrsEnableFuzz",
                "fsrsLoadBalance",
                "fsrsEasyDays",
                "baseEase",
                "maxLinkFactor",
                "lapsesIntervalChange",
                "easyBonus",
                "loadBalance",
            ]),
        );
    });
});

describe("the algorithm row", () => {
    /** A dropdown that remembers what it was given, standing in for Obsidian's. */
    function fakeDropdown() {
        const state = {
            options: [] as [string, string][],
            values: [] as string[],
            changed: undefined as ((value: string) => unknown) | undefined,
        };
        const dropdown = {
            addOption: (value: string, label: string) => (
                state.options.push([value, label]),
                dropdown
            ),
            setValue: (value: string) => (state.values.push(value), dropdown),
            onChange: (fn: (value: string) => unknown) => ((state.changed = fn), dropdown),
        };
        const setting = {
            addDropdown: (callback: (component: typeof dropdown) => void) => (
                callback(dropdown),
                setting
            ),
        };
        return { state, setting: setting as unknown as Setting };
    }

    /** `autoConfirm` stands in for a person pressing the dialog's confirm button the moment it opens. */
    function renderAlgorithm(stored: SchedulerKind, autoConfirm: boolean) {
        const pending: Promise<void>[] = [];
        const built = build(
            autoConfirm
                ? {
                      confirm: jest.fn((_title, _body, onConfirm) => {
                          pending.push(Promise.resolve(onConfirm()));
                      }),
                  }
                : {},
        );
        built.settings.algorithm = stored;
        const row = findRow(built.items, "Algorithm") as unknown as {
            render: (setting: Setting, group: SettingGroup) => void | (() => void);
        };
        const dropdown = fakeDropdown();
        row.render(dropdown.setting, {} as SettingGroup);
        const settled = () => Promise.all(pending);
        return { ...built, ...dropdown, row, settled };
    }

    test("it is a render row with its name, description and aliases", () => {
        const { items } = build();
        const row = findRow(items, "Algorithm");
        expect(row.desc).toBe("FSRS learns how well you remember. Note review always uses SM-2.");
        expect(row.aliases).toEqual(["fsrs", "sm-2", "sm2"]);
        expect(typeof (row as { render?: unknown }).render).toBe("function");
        expect(row.control).toBeUndefined();
    });

    test("the dropdown offers FSRS and SM-2 and shows the stored algorithm", () => {
        const { state } = renderAlgorithm(SchedulerKind.SM2, false);
        expect(state.options).toEqual([
            ["FSRS", "FSRS (recommended)"],
            ["SM-2-OSR", "SM-2"],
        ]);
        expect(state.values).toEqual(["SM-2-OSR"]);

        const fsrs = renderAlgorithm(SchedulerKind.FSRS, false);
        expect(fsrs.state.values).toEqual(["FSRS"]);
    });

    test("choosing the other algorithm puts the dropdown back and asks first", () => {
        const { state, settings, mocks } = renderAlgorithm(SchedulerKind.SM2, false);
        void state.changed?.("FSRS");
        expect(state.values).toEqual(["SM-2-OSR", "SM-2-OSR"]);
        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(mocks.confirm.mock.calls[0].slice(0, 2)).toEqual([
            "Switch to FSRS?",
            "Each card keeps its due date. The next time you answer a card, its schedule is written in the FSRS format.",
        ]);
        expect(settings.algorithm).toBe("SM-2-OSR");
        expect(mocks.commit).not.toHaveBeenCalled();
    });

    test("switching to SM-2 says the FSRS memory data is dropped", () => {
        const { state, mocks } = renderAlgorithm(SchedulerKind.FSRS, false);
        void state.changed?.("SM-2-OSR");
        expect(mocks.confirm.mock.calls[0].slice(0, 2)).toEqual([
            "Switch to SM-2?",
            "Each card keeps its due date. The next time you answer a card, its schedule is written in the SM-2 format and its FSRS memory data is dropped.",
        ]);
    });

    test("cancelling leaves the algorithm, the save and the screen as they were", async () => {
        const { state, settings, mocks } = renderAlgorithm(SchedulerKind.SM2, false);
        await state.changed?.("FSRS");
        expect(settings.algorithm).toBe("SM-2-OSR");
        expect(mocks.commit).not.toHaveBeenCalled();
        expect(mocks.refresh).not.toHaveBeenCalled();
        expect(state.values[state.values.length - 1]).toBe("SM-2-OSR");
    });

    test("confirming stores the algorithm, commits it, redraws the rows and shows the new choice", async () => {
        const { state, settings, mocks, settled } = renderAlgorithm(SchedulerKind.SM2, true);
        void state.changed?.("FSRS");
        await settled();
        expect(settings.algorithm).toBe("FSRS");
        expect(mocks.commit).toHaveBeenCalledTimes(1);
        expect(mocks.commit).toHaveBeenCalledWith(["algorithm"]);
        expect(mocks.refresh).toHaveBeenCalledTimes(1);
        expect(state.values).toEqual(["SM-2-OSR", "SM-2-OSR", "FSRS"]);
    });

    test("the stored algorithm is changed only after the confirm, not before", async () => {
        const { state, settings, mocks, settled } = renderAlgorithm(SchedulerKind.FSRS, true);
        mocks.commit.mockImplementation(() => {
            expect(settings.algorithm).toBe("SM-2-OSR");
            return Promise.resolve();
        });
        void state.changed?.("SM-2-OSR");
        await settled();
        expect(settings.algorithm).toBe("SM-2-OSR");
        expect(mocks.commit).toHaveBeenCalledWith(["algorithm"]);
    });

    test("picking the algorithm it already is asks nothing", () => {
        const { state, mocks } = renderAlgorithm(SchedulerKind.FSRS, false);
        void state.changed?.("FSRS");
        expect(mocks.confirm).not.toHaveBeenCalled();
        expect(mocks.commit).not.toHaveBeenCalled();
    });
});

describe("desired retention", () => {
    const RANGE = "Use a value from 70 to 99.";

    test("it is a percent from 70 to 99, with decimals allowed, that flags a value outside it", () => {
        const { items } = build();
        const row = findControl(items, "fsrsDesiredRetention");
        expect(row.name).toBe("Desired retention (%)");
        expect(row.desc).toBe(
            "Chance you still remember a card when it comes due. Higher means more reviews.",
        );
        expect(row.aliases).toEqual(["retention", "memory"]);
        expect(row.control).toMatchObject({
            type: "number",
            min: 70,
            max: 99,
            step: 1,
            defaultValue: 90,
        });

        const validate = validateOf(row);
        expect(validate(90 as never)).toBeUndefined();
        expect(validate(90.5 as never)).toBeUndefined();
        expect(validate(70 as never)).toBeUndefined();
        expect(validate(99 as never)).toBeUndefined();
        expect(validate(50 as never)).toBe(RANGE);
        expect(validate(69.9 as never)).toBe(RANGE);
        expect(validate(100 as never)).toBe(RANGE);
        expect(validate(NaN as never)).toBe(RANGE);
    });

    test("a stored fraction is shown as a percent: 0.905 reads 90.5 and passes", () => {
        const stored = cloneDefaultSettings();
        stored.fsrsDesiredRetention = 0.905;
        const { ctx, items, settings, mocks } = build({ settings: stored });
        const validate = validateOf(findControl(items, "fsrsDesiredRetention"));
        const shown = readControl(settings, "fsrsDesiredRetention", ctx.env);
        expect(shown).toBe(90.5);
        expect(validate(shown as never)).toBeUndefined();
        expect(settings.fsrsDesiredRetention).toBe(0.905);
        expect(mocks.commit).not.toHaveBeenCalled();
    });

    test("typing a percent stores the fraction", () => {
        const { ctx, settings } = build();
        writeControl(settings, "fsrsDesiredRetention", 85, ctx.env);
        expect(settings.fsrsDesiredRetention).toBe(0.85);
        writeControl(settings, "fsrsDesiredRetention", 92.5, ctx.env);
        expect(settings.fsrsDesiredRetention).toBe(0.925);
    });

    test("a stored value outside the range is flagged and never rewritten: 0.5 reads 50", () => {
        const stored = cloneDefaultSettings();
        stored.fsrsDesiredRetention = 0.5;
        const { ctx, items, settings, mocks } = build({ settings: stored });
        const validate = validateOf(findControl(items, "fsrsDesiredRetention"));
        const shown = readControl(settings, "fsrsDesiredRetention", ctx.env);
        expect(shown).toBe(50);
        expect(validate(shown as never)).toBe(RANGE);
        expect(settings.fsrsDesiredRetention).toBe(0.5);
        expect(readControl(settings, "fsrsDesiredRetention", ctx.env)).toBe(50);
        expect(mocks.commit).not.toHaveBeenCalled();
    });

    test("it is shown on FSRS only", () => {
        const { items, settings } = build();
        const row = findControl(items, "fsrsDesiredRetention");
        expect(typeof row.visible).toBe("function");
        settings.algorithm = SchedulerKind.FSRS;
        expect(truth(row.visible)).toBe(true);
        settings.algorithm = SchedulerKind.SM2;
        expect(truth(row.visible)).toBe(false);
        settings.algorithm = SchedulerKind.FSRS;
        expect(truth(row.visible)).toBe(true);
    });
});

describe("the expected workload row", () => {
    const NEEDS_MORE = "Review more cards to see an estimate.";
    const TREE = { sentinel: "deck hierarchy" };

    const statsCard = (overrides: Partial<StatsCard> = {}): StatsCard => ({
        id: null,
        decks: [""],
        state: "review",
        isFsrs: true,
        dueMs: null,
        intervalDays: 10,
        stability: 10,
        difficulty: 5,
        lastReviewMs: null,
        reps: 3,
        lapses: 0,
        suspended: false,
        buried: false,
        flag: 0,
        leech: false,
        ...overrides,
    });
    const reviewCards = (count: number, overrides: Partial<StatsCard> = {}) =>
        Array.from({ length: count }, () => statsCard(overrides));

    /** A plugin whose deck hierarchy can only be read once the vault index is loaded, as the real getter does. */
    function fakePlugin(loaded: boolean) {
        const vaultIndex = jest.fn(() => ({ reviewableRoot: TREE }));
        const dataManager = { isVaultIndexLoaded: jest.fn(() => loaded) };
        Object.defineProperty(dataManager, "vaultIndex", {
            get: () => {
                if (!loaded) throw new Error("vault index not loaded");
                return vaultIndex();
            },
        });
        return {
            plugin: { dataManager } as unknown as FlashcardStudioPlugin,
            dataManager,
            vaultIndex,
        };
    }

    /** Renders the row as Obsidian would and returns the text last written to its description. */
    function renderWorkload(
        options: { loaded?: boolean; cards?: StatsCard[]; algorithm?: SchedulerKind } = {},
    ) {
        const { plugin, dataManager, vaultIndex } = fakePlugin(options.loaded ?? true);
        collectMock.mockReturnValue({ cards: options.cards ?? [], decks: [] });
        const dayKey = jest.fn((_ms: number) => "2026-10-12");
        dayKeyMock.mockReturnValue(dayKey);
        const built = build({ plugin });
        built.settings.algorithm = options.algorithm ?? SchedulerKind.FSRS;
        const unsubscribe = jest.fn();
        built.mocks.watch.mockReturnValue(unsubscribe);
        const row = findRow(built.items, "Expected workload") as unknown as {
            render: (setting: Setting, group: SettingGroup) => void | (() => void);
        };
        const setDesc = jest.fn<void, [string]>();
        const cleanup = row.render({ setDesc } as unknown as Setting, {} as SettingGroup);
        const text = () => setDesc.mock.calls[setDesc.mock.calls.length - 1][0];
        return { ...built, setDesc, text, cleanup, unsubscribe, dataManager, vaultIndex, dayKey };
    }

    test("it is a render row with no value of its own, shown on FSRS only", () => {
        const { items, settings } = build();
        const row = findRow(items, "Expected workload");
        expect(typeof (row as { render?: unknown }).render).toBe("function");
        expect(row.control).toBeUndefined();
        expect(typeof row.visible).toBe("function");
        settings.algorithm = SchedulerKind.FSRS;
        expect(truth(row.visible)).toBe(true);
        settings.algorithm = SchedulerKind.SM2;
        expect(truth(row.visible)).toBe(false);
        settings.algorithm = SchedulerKind.FSRS;
        expect(truth(row.visible)).toBe(true);
    });

    test("building the group touches nothing of the plugin", () => {
        const touched = new Proxy(
            {},
            {
                get: (_target, name) => {
                    throw new Error("The plugin was read at build time: " + String(name));
                },
            },
        );
        expect(() => build({ plugin: touched as FlashcardStudioPlugin })).not.toThrow();
        expect(collectMock).not.toHaveBeenCalled();
    });

    test("before the cards are loaded it asks for more cards and never reads the deck hierarchy", () => {
        const { text, vaultIndex, dataManager } = renderWorkload({ loaded: false });
        expect(text()).toBe(NEEDS_MORE);
        expect(dataManager.isVaultIndexLoaded).toHaveBeenCalled();
        expect(vaultIndex).not.toHaveBeenCalled();
        expect(collectMock).not.toHaveBeenCalled();
    });

    test("with too few cards it asks for more", () => {
        const { text } = renderWorkload({ cards: reviewCards(19) });
        expect(text()).toBe(NEEDS_MORE);
    });

    test("it shows the reviews a day at the chosen retention and 5 points either side", () => {
        const { text, setDesc } = renderWorkload({ cards: reviewCards(20) });
        expect(setDesc).toHaveBeenCalledTimes(1);
        expect(text()).toBe(
            "About 2 reviews a day for your 20 cards. At 85%: about 1. At 95%: about 5.",
        );
    });

    test("it counts only FSRS cards that are not suspended and have a stability", () => {
        const { text } = renderWorkload({
            cards: [
                ...reviewCards(20),
                ...reviewCards(7, { isFsrs: false, stability: 0 }),
                ...reviewCards(5, { suspended: true }),
                ...reviewCards(4, { state: "new", stability: 0 }),
            ],
        });
        expect(text()).toBe(
            "About 2 reviews a day for your 20 cards. At 85%: about 1. At 95%: about 5.",
        );
    });

    test("it reads the deck hierarchy once, for today's study day", () => {
        const { dayKey } = renderWorkload({ cards: reviewCards(20) });
        expect(collectMock).toHaveBeenCalledTimes(1);
        expect(collectMock).toHaveBeenCalledWith(TREE, "2026-10-12");
        expect(dayKey).toHaveBeenCalledTimes(1);
        expect(typeof dayKey.mock.calls[0][0]).toBe("number");
    });

    test("it watches the algorithm, retention, the parameters and the maximum interval", () => {
        const { mocks } = renderWorkload({ cards: reviewCards(20) });
        expect(mocks.watch).toHaveBeenCalledTimes(1);
        expect(mocks.watch.mock.calls[0][0]).toEqual([
            "algorithm",
            "fsrsDesiredRetention",
            "fsrsWeights",
            "maximumInterval",
        ]);
    });

    test("its cleanup is the unsubscribe from the watch", () => {
        const { cleanup, unsubscribe } = renderWorkload({ cards: reviewCards(20) });
        expect(cleanup).toBe(unsubscribe);
    });

    test("when retention changes it rewrites the text from the same cards without reading them again", () => {
        const { text, setDesc, settings, mocks } = renderWorkload({ cards: reviewCards(20) });
        settings.fsrsDesiredRetention = 0.95;
        mocks.watch.mock.calls[0][1]();
        expect(setDesc).toHaveBeenCalledTimes(2);
        expect(text()).toBe(
            "About 5 reviews a day for your 20 cards. At 90%: about 2. At 99%: about 20.",
        );
        expect(collectMock).toHaveBeenCalledTimes(1);
    });

    test("when the maximum interval changes it uses it", () => {
        const { text, settings, mocks } = renderWorkload({
            cards: reviewCards(20, { stability: 10000 }),
        });
        settings.maximumInterval = 100;
        mocks.watch.mock.calls[0][1]();
        expect(text()).toBe(
            "Less than 1 review a day for your 20 cards. At 85%: less than 1. At 95%: less than 1.",
        );
        settings.fsrsDesiredRetention = 0.8;
        settings.maximumInterval = 1;
        mocks.watch.mock.calls[0][1]();
        expect(text()).toBe(
            "About 20 reviews a day for your 20 cards. At 75%: about 20. At 85%: about 20.",
        );
    });

    test("while the algorithm is not FSRS it neither reads the cards nor writes a text", () => {
        const { setDesc, vaultIndex, dataManager, dayKey } = renderWorkload({
            cards: reviewCards(20),
            algorithm: SchedulerKind.SM2,
        });
        expect(setDesc).not.toHaveBeenCalled();
        expect(dataManager.isVaultIndexLoaded).not.toHaveBeenCalled();
        expect(vaultIndex).not.toHaveBeenCalled();
        expect(collectMock).not.toHaveBeenCalled();
        expect(dayKey).not.toHaveBeenCalled();
    });

    test("changes while the algorithm is not FSRS read nothing either", () => {
        const { setDesc, settings, mocks } = renderWorkload({
            cards: reviewCards(20),
            algorithm: SchedulerKind.SM2,
        });
        settings.fsrsDesiredRetention = 0.8;
        mocks.watch.mock.calls[0][1]();
        expect(setDesc).not.toHaveBeenCalled();
        expect(collectMock).not.toHaveBeenCalled();
    });

    test("switching to FSRS reads the cards then and writes the text", () => {
        const { text, setDesc, settings, mocks } = renderWorkload({
            cards: reviewCards(20),
            algorithm: SchedulerKind.SM2,
        });
        settings.algorithm = SchedulerKind.FSRS;
        mocks.watch.mock.calls[0][1]();
        expect(setDesc).toHaveBeenCalledTimes(1);
        expect(text()).toBe(
            "About 2 reviews a day for your 20 cards. At 85%: about 1. At 95%: about 5.",
        );
        expect(collectMock).toHaveBeenCalledTimes(1);

        // Later changes use the cards already read
        settings.fsrsDesiredRetention = 0.95;
        mocks.watch.mock.calls[0][1]();
        expect(collectMock).toHaveBeenCalledTimes(1);
        expect(setDesc).toHaveBeenCalledTimes(2);
    });

    describe("when working it out fails", () => {
        const FAILED = "Couldn't estimate the workload.";
        let errorSpy: jest.SpyInstance;
        beforeEach(() => {
            errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        });
        afterEach(() => errorSpy.mockRestore());

        test("reading the cards fails: the row says so, logs it, and rendering does not throw", () => {
            collectMock.mockImplementation(() => {
                throw new Error("tree is gone");
            });
            const { plugin } = fakePlugin(true);
            const built = build({ plugin });
            built.settings.algorithm = SchedulerKind.FSRS;
            const row = findRow(built.items, "Expected workload") as unknown as {
                render: (setting: Setting, group: SettingGroup) => void | (() => void);
            };
            const setDesc = jest.fn<void, [string]>();
            expect(() =>
                row.render({ setDesc } as unknown as Setting, {} as SettingGroup),
            ).not.toThrow();
            expect(setDesc).toHaveBeenCalledWith(FAILED);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(built.mocks.watch).toHaveBeenCalledTimes(1);
        });

        test("a later change tries again, and a text replaces the failure", () => {
            collectMock.mockImplementationOnce(() => {
                throw new Error("tree is gone");
            });
            const { text, setDesc, mocks, settings } = renderWorkload({ cards: reviewCards(20) });
            expect(text()).toBe(FAILED);
            collectMock.mockReturnValue({ cards: reviewCards(20), decks: [] });
            settings.fsrsDesiredRetention = 0.9;
            mocks.watch.mock.calls[0][1]();
            expect(setDesc).toHaveBeenCalledTimes(2);
            expect(text()).toBe(
                "About 2 reviews a day for your 20 cards. At 85%: about 1. At 95%: about 5.",
            );
        });

        test("the estimate itself fails: the same fallback, and the watcher does not throw", () => {
            const { text, settings, mocks } = renderWorkload({ cards: reviewCards(20) });
            Object.defineProperty(settings, "fsrsWeights", {
                get: () => {
                    throw new Error("unreadable parameters");
                },
            });
            expect(() => mocks.watch.mock.calls[0][1]()).not.toThrow();
            expect(text()).toBe(FAILED);
            expect(errorSpy).toHaveBeenCalledTimes(1);
        });
    });

    test("a retention that cannot be used goes back to asking for more cards", () => {
        const { text, settings, mocks } = renderWorkload({ cards: reviewCards(20) });
        settings.fsrsDesiredRetention = 1;
        mocks.watch.mock.calls[0][1]();
        expect(text()).toBe(NEEDS_MORE);
    });
});

describe("the optimize row", () => {
    function optimizeRow() {
        const built = build();
        const row = findRow(built.items, "Optimize parameters") as unknown as SettingDefinition & {
            action: (el: HTMLElement, index: number) => void;
        };
        return { ...built, row };
    }

    test("it is an action row that says how many reviews it needs, shown on FSRS only", () => {
        const { row, settings } = optimizeRow();
        expect(typeof row.action).toBe("function");
        expect(row.control).toBeUndefined();
        expect(row.desc).toBe(
            "Fit FSRS to your own reviews. Needs at least " + MIN_REVIEWS_TO_OPTIMIZE + " reviews.",
        );
        expect(row.aliases).toEqual(["optimizer", "weights"]);
        expect(typeof row.visible).toBe("function");
        settings.algorithm = SchedulerKind.FSRS;
        expect(truth(row.visible)).toBe(true);
        settings.algorithm = SchedulerKind.SM2;
        expect(truth(row.visible)).toBe(false);
    });

    test("it opens the optimizer for this app and plugin without touching the settings", () => {
        const { row, settings, mocks } = optimizeRow();
        expect(modalMock).not.toHaveBeenCalled();
        row.action({} as HTMLElement, 0);
        expect(modalMock).toHaveBeenCalledTimes(1);
        expect(modalMock.mock.calls[0][0]).toBe(app);
        expect(modalMock.mock.calls[0][1]).toBe(plugin);
        expect((modalMock.mock.results[0].value as { open: jest.Mock }).open).toHaveBeenCalledTimes(
            1,
        );
        expect(settings.fsrsWeights).toBe("");
        expect(mocks.commit).not.toHaveBeenCalled();
    });

    test("applying the result stores the parameters, commits them and says so", async () => {
        const { row, settings, mocks } = optimizeRow();
        row.action({} as HTMLElement, 0);
        const apply = modalMock.mock.calls[0][2];
        await apply([0.4, 0.60000001, 2.4]);
        expect(settings.fsrsWeights).toBe("0.4, 0.6, 2.4");
        expect(mocks.commit).toHaveBeenCalledTimes(1);
        expect(mocks.commit).toHaveBeenCalledWith(["fsrsWeights"]);
        expect(Notice).toHaveBeenCalledWith("FSRS parameters updated.");
    });

    test("applying the result redraws the rows after the save, so the Advanced FSRS entry shows the new parameters", async () => {
        const { row, mocks } = optimizeRow();
        row.action({} as HTMLElement, 0);
        const apply = modalMock.mock.calls[0][2];
        expect(mocks.rebuild).not.toHaveBeenCalled();
        await apply([0.4, 0.60000001, 2.4]);
        expect(mocks.rebuild).toHaveBeenCalledTimes(1);
        expect(mocks.commit.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.rebuild.mock.invocationCallOrder[0],
        );
    });
});

describe("next day starts at", () => {
    test("it is a time of day written in 24-hour time", () => {
        const { items } = build();
        const row = findControl(items, "startOfDay");
        expect(row.name).toBe("Next day starts at");
        expect(row.desc).toBe("When tomorrow's cards become due, in 24-hour time such as 04:00.");
        expect(row.aliases).toEqual(["midnight", "day"]);
        expect(row.control).toMatchObject({ type: "text" });
        expect(row.visible).toBeUndefined();

        const validate = validateOf(row);
        expect(validate("04:00" as never)).toBeUndefined();
        expect(validate("4:30" as never)).toBeUndefined();
        expect(validate("23:59:59" as never)).toBeUndefined();
        expect(validate("24:00" as never)).toBe("Use 24-hour time, such as 04:00.");
        expect(validate("noon" as never)).toBe("Use 24-hour time, such as 04:00.");
    });
});

describe("maximum interval", () => {
    test("it is a whole number of days from 1 to 36525", () => {
        const { items } = build();
        const row = findControl(items, "maximumInterval");
        expect(row.name).toBe("Maximum interval (days)");
        expect(row.desc).toBe("No card waits longer than this.");
        expect(row.control).toMatchObject({ type: "number", min: 1, max: 36525 });
        expect(row.visible).toBeUndefined();

        const validate = validateOf(row);
        expect(validate(0 as never)).toBe("Use a number from 1 to 36525.");
        expect(validate(1.5 as never)).toBe("Use a whole number.");
        expect(validate(36526 as never)).toBe("Use a number from 1 to 36525.");
        expect(validate(1 as never)).toBeUndefined();
        expect(validate(365 as never)).toBeUndefined();
        expect(validate(36525 as never)).toBeUndefined();
    });
});

describe("the Advanced FSRS page", () => {
    const KEYS = [
        "fsrsLearningSteps",
        "fsrsRelearningSteps",
        "fsrsEnableFuzz",
        "fsrsLoadBalance",
        "fsrsWeights",
    ] as const;

    test("it is a page with one headless group, shown on FSRS only", () => {
        const { page, settings } = build();
        const advanced = page("Advanced FSRS");
        expect(advanced.type).toBe("page");
        expect(typeof advanced.visible).toBe("function");
        settings.algorithm = SchedulerKind.FSRS;
        expect(truth(advanced.visible)).toBe(true);
        settings.algorithm = SchedulerKind.SM2;
        expect(truth(advanced.visible)).toBe(false);
        expect(pageGroup(advanced).items).toHaveLength(5);
    });

    test("its entry says whether the parameters are the defaults, as they are now", () => {
        const { page, settings } = build();
        const show = () => (page("Advanced FSRS").displayValue as () => string)();
        settings.fsrsWeights = "";
        expect(show()).toBe("Default");
        settings.fsrsWeights = "0.4, 0.6, 2.4";
        expect(show()).toBe("Custom");
        settings.fsrsWeights = "";
        expect(show()).toBe("Default");
    });

    test("it holds the steps, the spread, and the parameters", () => {
        const { page } = build();
        const rows = (pageGroup(page("Advanced FSRS")).items ?? []) as SettingDefinition[];
        expect(rows.map((row) => row.name)).toEqual([
            "Learning steps",
            "Relearning steps",
            "Spread out due dates",
            "Balance due dates",
            "Custom parameters",
        ]);
        expect(rows.map((row) => row.control?.key)).toEqual([...KEYS]);
        expect(rows[0].desc).toBe(
            "Waits before a new card graduates, such as 1m 10m. Empty lets FSRS decide.",
        );
        expect(rows[1].desc).toBe("Waits after you forget a card, such as 10m.");
        expect(rows[2].desc).toBe(
            "Vary long intervals a little so cards learned together don't all come due the same day.",
        );
        expect(rows[3].desc).toBe(
            "Prefer quieter days inside FSRS's fuzz window. Off leaves FSRS unchanged.",
        );
        expect(rows[4].desc).toBe(
            "Paste 17, 19 or 21 numbers, or leave empty for the defaults. Optimize fills this in.",
        );
        expect(rows[0].control).toMatchObject({ type: "text" });
        expect(rows[1].control).toMatchObject({ type: "text" });
        expect(rows[2].control).toMatchObject({ type: "toggle" });
        expect(rows[3].control).toMatchObject({ type: "toggle", key: "fsrsLoadBalance" });
        expect(rows[4].control).toMatchObject({ type: "textarea", rows: 3 });
    });

    test("steps must be written such as 1m 10m, and may be empty", () => {
        const { page } = build();
        const rows = (pageGroup(page("Advanced FSRS")).items ?? []) as SettingDefinition[];
        for (const row of [rows[0], rows[1]]) {
            const validate = validateOf(row);
            expect(validate("1m 10m" as never)).toBeUndefined();
            expect(validate("" as never)).toBeUndefined();
            expect(validate("soon" as never)).toBe("Use steps such as 1m 10m 1h 1d.");
        }
    });

    test("parameters are checked against the relearning steps as they are when you type", () => {
        const { page, settings } = build();
        const rows = (pageGroup(page("Advanced FSRS")).items ?? []) as SettingDefinition[];
        const validate = validateOf(rows[4]);
        expect(validate("" as never)).toBeUndefined();
        expect(validate("1 2 3" as never)).toMatch(/^These are not FSRS parameters: /);

        // The relearning steps are read when the check runs, never when the page was built.
        const readsSteps = jest.fn(() => "10m 1h");
        Object.defineProperty(settings, "fsrsRelearningSteps", { get: readsSteps });
        validate("" as never);
        expect(readsSteps).toHaveBeenCalledTimes(1);
    });

    test("the header button restores its five options after asking, and nothing else", async () => {
        const { page, settings, mocks } = build();
        settings.fsrsLearningSteps = "5m";
        settings.fsrsRelearningSteps = "1d";
        settings.fsrsEnableFuzz = true;
        settings.fsrsLoadBalance = true;
        settings.fsrsWeights = "0.4, 0.6, 2.4";
        settings.fsrsDesiredRetention = 0.8;

        clickHeaderButton(pageGroup(page("Advanced FSRS")));
        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(settings.fsrsLearningSteps).toBe("5m");

        await mocks.confirm.mock.calls[0][2]();
        const fresh = freshInstallSettings();
        expect(settings.fsrsLearningSteps).toBe(fresh.fsrsLearningSteps);
        expect(settings.fsrsRelearningSteps).toBe(fresh.fsrsRelearningSteps);
        expect(settings.fsrsEnableFuzz).toBe(fresh.fsrsEnableFuzz);
        expect(settings.fsrsLoadBalance).toBe(fresh.fsrsLoadBalance);
        expect(settings.fsrsWeights).toBe(fresh.fsrsWeights);
        expect(settings.fsrsDesiredRetention).toBe(0.8);
        expect(mocks.commit).toHaveBeenCalledWith([...KEYS]);
        expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    });
});

describe("easy days", () => {
    test("the page shows one saved toggle for each weekday", async () => {
        const { page, settings, mocks } = build();
        const easyDays = page("Easy days");
        const rows = (pageGroup(easyDays).items ?? []) as SettingDefinition[];
        expect(rows.map((row) => row.name)).toEqual([
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
        ]);

        let changed: ((value: boolean) => unknown) | undefined;
        (rows[1].render as (setting: Setting) => void)({
            addToggle: (
                callback: (toggle: {
                    setValue(value: boolean): unknown;
                    onChange(callback: (value: boolean) => unknown): unknown;
                }) => void,
            ) => {
                const toggle = {
                    setValue: () => toggle,
                    onChange: (callback: (value: boolean) => unknown) => (changed = callback),
                };
                callback(toggle);
            },
        } as unknown as Setting);

        await changed?.(true);
        expect(settings.fsrsEasyDays).toEqual([1]);
        expect(mocks.commit).toHaveBeenCalledWith(["fsrsEasyDays"]);
    });
});

describe("the SM-2 page", () => {
    const rowsOf = (page: SettingDefinitionPage) =>
        (pageGroup(page).items ?? []) as SettingDefinition[];

    test("it is a page with one headless group, shown on SM-2 only", () => {
        const { page, settings } = build();
        const sm2 = page("SM-2");
        expect(sm2.type).toBe("page");
        expect(typeof sm2.visible).toBe("function");
        settings.algorithm = SchedulerKind.SM2;
        expect(truth(sm2.visible)).toBe(true);
        settings.algorithm = SchedulerKind.FSRS;
        expect(truth(sm2.visible)).toBe(false);
        settings.algorithm = SchedulerKind.SM2;
        expect(truth(sm2.visible)).toBe(true);
        expect(pageGroup(sm2).items).toHaveLength(5);
    });

    test("its entry shows the starting ease as it is now", () => {
        const { page, settings } = build();
        const show = () => (page("SM-2").displayValue as () => string)();
        settings.baseEase = 250;
        expect(show()).toBe("Starting ease 250%");
        settings.baseEase = 300;
        expect(show()).toBe("Starting ease 300%");
    });

    test("it holds the five options in order", () => {
        const { page } = build();
        const rows = rowsOf(page("SM-2"));
        expect(rows.map((row) => row.name)).toEqual([
            "Starting ease (%)",
            "Linked notes' share",
            "Hard interval",
            "Easy bonus (%)",
            "Load balance",
        ]);
        expect(rows.map((row) => row.control?.key)).toEqual([
            "baseEase",
            "maxLinkFactor",
            "lapsesIntervalChange",
            "easyBonus",
            "loadBalance",
        ]);
        expect(rows.map((row) => row.desc)).toEqual([
            "Ease of a new note. At least 130.",
            "How much the ease of linked notes counts toward a new note's ease.",
            "A Hard answer multiplies the interval by this.",
            "How much longer an Easy interval is than Good. At least 100.",
            "Nudge due dates so each day has about the same number of reviews.",
        ]);
    });

    test("starting ease is a whole number from 130 to 1000", () => {
        const { page } = build();
        const row = rowsOf(page("SM-2"))[0];
        expect(row.control).toMatchObject({ type: "number", min: 130, max: 1000 });
        const validate = validateOf(row);
        expect(validate(129 as never)).toBe("Use a number from 130 to 1000.");
        expect(validate(250.5 as never)).toBe("Use a whole number.");
        expect(validate(1001 as never)).toBe("Use a number from 130 to 1000.");
        expect(validate(130 as never)).toBeUndefined();
        expect(validate(250 as never)).toBeUndefined();
    });

    test("linked notes' share and hard interval are percent sliders", () => {
        const { page } = build();
        const [, share, hard] = rowsOf(page("SM-2"));
        expect(share.control).toMatchObject({ type: "slider", min: 0, max: 100, step: 1 });
        expect(hard.control).toMatchObject({ type: "slider", min: 1, max: 99, step: 1 });
        for (const row of [share, hard]) {
            const format = (row.control as { displayFormat: (value: number) => string })
                .displayFormat;
            expect(format(50)).toBe("50%");
            expect(format(100)).toBe("100%");
        }
    });

    test("easy bonus is a whole percent from 100 to 1000", () => {
        const { page } = build();
        const row = rowsOf(page("SM-2"))[3];
        expect(row.control).toMatchObject({ type: "number", min: 100, max: 1000 });
        const validate = validateOf(row);
        expect(validate(99 as never)).toBe("Use a number from 100 to 1000.");
        expect(validate(130.5 as never)).toBe("Use a whole number.");
        expect(validate(1001 as never)).toBe("Use a number from 100 to 1000.");
        expect(validate(100 as never)).toBeUndefined();
        expect(validate(130 as never)).toBeUndefined();
    });

    test("load balance is a toggle", () => {
        const { page } = build();
        expect(rowsOf(page("SM-2"))[4].control).toMatchObject({
            type: "toggle",
            key: "loadBalance",
        });
    });

    test("the header button restores its five options after asking, and nothing else", async () => {
        const { page, settings, mocks } = build();
        settings.baseEase = 300;
        settings.maxLinkFactor = 0.2;
        settings.lapsesIntervalChange = 0.9;
        settings.easyBonus = 2;
        settings.loadBalance = false;
        settings.maximumInterval = 99;

        clickHeaderButton(pageGroup(page("SM-2")));
        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(settings.baseEase).toBe(300);

        await mocks.confirm.mock.calls[0][2]();
        const fresh = freshInstallSettings();
        expect(settings.baseEase).toBe(fresh.baseEase);
        expect(settings.maxLinkFactor).toBe(fresh.maxLinkFactor);
        expect(settings.lapsesIntervalChange).toBe(fresh.lapsesIntervalChange);
        expect(settings.easyBonus).toBe(fresh.easyBonus);
        expect(settings.loadBalance).toBe(fresh.loadBalance);
        expect(settings.maximumInterval).toBe(99);
        expect(mocks.commit).toHaveBeenCalledWith([
            "baseEase",
            "maxLinkFactor",
            "lapsesIntervalChange",
            "easyBonus",
            "loadBalance",
        ]);
        expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    });
});

describe("the notices after a value is typed", () => {
    /** `settings` are the settings before the typed value is written; `previous` is what was typed before it. */
    const notice = (
        key: string,
        raw: unknown,
        settings?: Partial<StudioSettings>,
        previous?: unknown,
    ) => {
        const fake = fakeContext();
        Object.assign(fake.settings, settings);
        return schedulingNotices[key]?.(raw, fake.settings, previous);
    };
    const numbers = (count: number) => Array.from({ length: count }, () => "1").join(" ");
    /** The default FSRS-4, FSRS-5 and FSRS-6 parameters, all inside their allowed ranges. */
    const FSRS4 =
        "0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61";
    const FSRS5 =
        "0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621";
    const FSRS6 =
        "0.2172, 1.1771, 3.2602, 16.1507, 7.0114, 0.57, 2.0966, 0.0069, 1.5261, 0.112, 1.0178, 1.849, 0.1133, 0.3127, 2.2934, 0.2191, 3.0004, 0.7536, 0.3332, 0.1437, 0.2";
    const STEPS = "Steps of a day or more work better as regular reviews.";
    const CONVERTED = "Converted to the 21 parameters of FSRS-6.";

    test("only the weights and the two step lists have one", () => {
        expect(Object.keys(schedulingNotices).sort()).toEqual([
            "fsrsLearningSteps",
            "fsrsRelearningSteps",
            "fsrsWeights",
        ]);
    });

    test("17 or 19 parameters, typed over something else, are said to be converted to the 21 of FSRS-6", () => {
        expect(notice("fsrsWeights", FSRS4)).toBe(CONVERTED);
        expect(notice("fsrsWeights", FSRS5)).toBe(CONVERTED);
        expect(notice("fsrsWeights", FSRS4, { fsrsWeights: FSRS6 })).toBe(CONVERTED);
        expect(notice("fsrsWeights", FSRS5, {}, FSRS4)).toBe(CONVERTED);
    });

    test("typing more into 17 parameters that were already converted says nothing again", () => {
        // What is stored is the 21 they became, so only the text typed before can say it was the same count.
        expect(notice("fsrsWeights", FSRS4 + " ", { fsrsWeights: FSRS6 }, FSRS4)).toBeUndefined();
        expect(notice("fsrsWeights", FSRS4, { fsrsWeights: FSRS6 }, FSRS4)).toBeUndefined();
        expect(notice("fsrsWeights", FSRS5 + "5", { fsrsWeights: FSRS6 }, FSRS5)).toBeUndefined();
    });

    test("with nothing typed before, parameters stored as 17 and typed as 17 are not newly 17", () => {
        expect(notice("fsrsWeights", FSRS4, { fsrsWeights: FSRS4 })).toBeUndefined();
    });

    test("17 parameters typed again after other text in between are newly 17 and say so", () => {
        expect(notice("fsrsWeights", FSRS4, { fsrsWeights: FSRS6 }, "")).toBe(CONVERTED);
        expect(notice("fsrsWeights", FSRS4, { fsrsWeights: FSRS6 }, FSRS6)).toBe(CONVERTED);
        expect(notice("fsrsWeights", FSRS4, { fsrsWeights: FSRS6 }, FSRS5)).toBe(CONVERTED);
    });

    test("21 parameters, none, or text that is not parameters say nothing", () => {
        expect(notice("fsrsWeights", FSRS6)).toBeUndefined();
        expect(notice("fsrsWeights", "")).toBeUndefined();
        expect(notice("fsrsWeights", numbers(17) + " nope")).toBeUndefined();
    });

    test("17 tokens of which one is not a number are not parameters, so nothing was converted", () => {
        const text = numbers(16) + " x";
        expect(text.split(" ")).toHaveLength(17);
        expect(notice("fsrsWeights", text)).toBeUndefined();
    });

    test.each(["fsrsLearningSteps", "fsrsRelearningSteps"] as const)(
        "a day or more in %s suggests regular reviews",
        (key) => {
            expect(notice(key, "1m 1d")).toBe(STEPS);
            expect(notice(key, "24h")).toBe(STEPS);
            expect(notice(key, "1m 10m")).toBeUndefined();
            expect(notice(key, "23h")).toBeUndefined();
            expect(notice(key, "")).toBeUndefined();
            expect(notice(key, "later")).toBeUndefined();
        },
    );

    test.each(["fsrsLearningSteps", "fsrsRelearningSteps"] as const)(
        "the %s notice shows only when the stored steps had none of a day or more",
        (key) => {
            const stored = (steps: string) => ({ [key]: steps });
            expect(notice(key, "1m 1d", stored("1m 10m"))).toBe(STEPS);
            expect(notice(key, "1m 1d", stored(""))).toBe(STEPS);
            expect(notice(key, "1m 1d", stored("1m 23h"))).toBe(STEPS);
            // Already had one: more keystrokes, or another long step, say nothing
            expect(notice(key, "1m 1d", stored("1m 1d"))).toBeUndefined();
            expect(notice(key, "1m 1d ", stored("1m 1d"))).toBeUndefined();
            expect(notice(key, "1m 2d", stored("1m 1d"))).toBeUndefined();
            expect(notice(key, "24h", stored("2d"))).toBeUndefined();
            // Going back to short steps says nothing either
            expect(notice(key, "1m", stored("1m 1d"))).toBeUndefined();
        },
    );

    test("each list of steps is compared with its own stored steps", () => {
        expect(notice("fsrsLearningSteps", "1d", { fsrsRelearningSteps: "2d" })).toBe(STEPS);
        expect(notice("fsrsRelearningSteps", "1d", { fsrsLearningSteps: "2d" })).toBe(STEPS);
        expect(notice("fsrsLearningSteps", "1d", { fsrsLearningSteps: "2d" })).toBeUndefined();
        expect(notice("fsrsRelearningSteps", "1d", { fsrsRelearningSteps: "2d" })).toBeUndefined();
    });
});
