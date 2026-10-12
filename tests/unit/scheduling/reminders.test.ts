import { State } from "ts-fsrs";

import { Card } from "src/data/data-structures/card/flashcard";
import { Deck } from "src/data/decks/deck";
import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { DEFAULT_DATA } from "src/data/stored-data";
import { ReminderManager } from "src/scheduling/reminders";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { moment } from "src/utils/moment-en";

type ReminderSettings = Pick<
    typeof DEFAULT_SETTINGS,
    | "enableReviewReminders"
    | "reviewReminderIntervalMinutes"
    | "reviewReminderCheckOnStartup"
    | "reviewReminderAutoOpen"
    | "dailyLimitsEnabled"
    | "newCardsPerDay"
    | "reviewsPerDay"
>;

function dueCard(): Card {
    return new Card({
        scheduleInfo: new Sm2State(moment("2026-10-12"), 1, 250),
    });
}

function learningCard(): Card {
    return new Card({
        scheduleInfo: new FsrsState(
            moment("2026-10-12"),
            1,
            5,
            1,
            State.Learning,
            1,
            0,
            0,
            moment("2026-10-11"),
        ),
    });
}

function deckWith(...cards: Card[]): Deck {
    const deck = Deck.emptyDeck;
    deck.newReviewItems = cards.filter((card) => card.isNew);
    deck.dueReviewItems = cards.filter((card) => !card.isNew);
    return deck;
}

function setup(
    options: {
        initialized?: boolean;
        loaded?: boolean;
        coreLoaded?: boolean;
        settings?: Partial<ReminderSettings>;
        deck?: Deck | null;
        entries?: unknown[];
        uiState?: number;
        focused?: boolean;
        syncLock?: boolean;
    } = {},
) {
    const settings = { ...DEFAULT_SETTINGS, ...options.settings };
    const registeredIntervals: number[] = [];
    const plugin = {
        isInitialized: options.initialized ?? true,
        registerInterval: jest.fn((id: number) => {
            registeredIntervals.push(id);
            return id;
        }),
    };
    const dataManager = {
        isDataLoaded: jest.fn(() => options.loaded ?? true),
        isVaultIndexLoaded: jest.fn(() => options.coreLoaded ?? true),
        syncLock: options.syncLock ?? false,
        sync: jest.fn().mockResolvedValue(undefined),
        vaultIndex: {
            remainingRoot: "deck" in options ? options.deck : deckWith(dueCard()),
        },
        settingsManager: { settings },
        data: { ...DEFAULT_DATA, settings, limitOverride: DEFAULT_DATA.limitOverride },
        reviewLog: { readMonths: jest.fn().mockResolvedValue(options.entries ?? []) },
    };
    const uiManager = {
        uiState: options.uiState ?? 0,
        isStudioInFocus: options.focused ?? false,
        notifyReviewReminder: jest.fn().mockResolvedValue(undefined),
        openDeckContainer: jest.fn().mockResolvedValue(undefined),
    };

    return {
        manager: new ReminderManager(plugin as never, uiManager as never, dataManager as never),
        plugin,
        registeredIntervals,
        dataManager,
        uiManager,
    };
}

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("ReminderManager", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-10-12T12:00:00Z"));
        window.activeDocument = document;
        // Obsidian adds Node.instanceOf at runtime; jsdom has no such method.
        (Node.prototype as unknown as { instanceOf: unknown }).instanceOf = function (
            this: Node,
            type: new () => unknown,
        ) {
            return this instanceof type;
        };
        document.body.replaceChildren();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test.each([
        ["the plugin is not initialized", { initialized: false }],
        ["reminders are disabled", { settings: { enableReviewReminders: false } }],
    ])("does not start when %s", (_reason, options) => {
        const { manager, plugin } = setup(options);

        manager.restartReviewReminders();

        expect(plugin.registerInterval).not.toHaveBeenCalled();
    });

    test("registers a timer and checks immediately when startup checks are enabled", async () => {
        const { manager, plugin, dataManager, uiManager } = setup({
            settings: { enableReviewReminders: true, reviewReminderCheckOnStartup: true },
        });

        manager.restartReviewReminders();
        await flush();

        expect(plugin.registerInterval).toHaveBeenCalledTimes(1);
        expect(dataManager.sync).toHaveBeenCalledTimes(1);
        expect(uiManager.notifyReviewReminder).toHaveBeenCalledTimes(1);
    });

    test("uses the default interval for a NaN setting", () => {
        const { manager, plugin } = setup({
            settings: { enableReviewReminders: true, reviewReminderIntervalMinutes: Number.NaN },
        });

        manager.restartReviewReminders();

        expect(plugin.registerInterval).toHaveBeenCalledWith(expect.any(Number));
        expect(jest.getTimerCount()).toBe(1);
        jest.advanceTimersByTime(DEFAULT_SETTINGS.reviewReminderIntervalMinutes * 60_000 - 1);
        expect(jest.getTimerCount()).toBe(1);
    });

    test("stops its registered interval on restart and stop", () => {
        const { manager } = setup({ settings: { enableReviewReminders: true } });

        manager.restartReviewReminders();
        manager.restartReviewReminders();
        manager.stopReviewReminders();

        expect(jest.getTimerCount()).toBe(0);
    });

    test("leaves its interval registered for Obsidian to clear on unload", async () => {
        const { manager, registeredIntervals, dataManager } = setup({
            settings: { enableReviewReminders: true },
        });

        manager.restartReviewReminders();
        window.clearInterval(registeredIntervals[0]);
        jest.advanceTimersByTime(DEFAULT_SETTINGS.reviewReminderIntervalMinutes * 60_000);
        await flush();

        expect(dataManager.sync).not.toHaveBeenCalled();
    });

    test("checks again on each interval", async () => {
        const { manager, dataManager } = setup({ settings: { enableReviewReminders: true } });

        manager.restartReviewReminders();
        jest.advanceTimersByTime(DEFAULT_SETTINGS.reviewReminderIntervalMinutes * 60_000);
        await flush();

        expect(dataManager.sync).toHaveBeenCalledTimes(1);
    });

    test.each([
        ["data is unavailable", { loaded: false }],
        ["the core is unavailable", { coreLoaded: false }],
        ["the review interface is open", { uiState: 2 }],
        ["the review interface has focus", { focused: true }],
        ["a sync is in progress", { syncLock: true }],
    ])("skips a check when %s", async (_reason, options) => {
        const { manager, dataManager, uiManager } = setup({
            ...options,
            settings: { enableReviewReminders: true, reviewReminderCheckOnStartup: true },
        });

        manager.restartReviewReminders();
        await flush();

        expect(dataManager.sync).not.toHaveBeenCalled();
        expect(uiManager.notifyReviewReminder).not.toHaveBeenCalled();
    });

    test.each([
        [
            "an input",
            () => {
                const element = document.createElement("input");
                document.body.append(element);
                element.focus();
            },
        ],
        [
            "a textarea",
            () => {
                const element = document.createElement("textarea");
                document.body.append(element);
                element.focus();
            },
        ],
        [
            "a content-editable element",
            () => {
                const element = document.createElement("div");
                element.contentEditable = "true";
                element.setAttribute("contenteditable", "true");
                element.tabIndex = 0;
                document.body.append(element);
                element.focus();
            },
        ],
        [
            "a CodeMirror editor",
            () => {
                const element = document.createElement("textarea");
                const editor = document.createElement("div");
                editor.className = "cm-editor";
                editor.append(element);
                document.body.append(editor);
                element.focus();
            },
        ],
    ])("skips a check while the user is typing in %s", async (_description, focus) => {
        focus();
        const { manager, dataManager } = setup({
            settings: { enableReviewReminders: true, reviewReminderCheckOnStartup: true },
        });

        manager.restartReviewReminders();
        await flush();

        expect(dataManager.sync).not.toHaveBeenCalled();
    });

    test.each([
        ["the tree is absent", null],
        ["there are no eligible cards", deckWith()],
    ])("does not notify when %s", async (_reason, deck) => {
        const { manager, uiManager } = setup({
            deck,
            settings: { enableReviewReminders: true, reviewReminderCheckOnStartup: true },
        });

        manager.restartReviewReminders();
        await flush();

        expect(uiManager.notifyReviewReminder).not.toHaveBeenCalled();
    });

    test("rechecks activity after syncing", async () => {
        const { manager, uiManager } = setup({
            settings: { enableReviewReminders: true, reviewReminderCheckOnStartup: true },
        });
        uiManager.notifyReviewReminder.mockImplementation(async () => undefined);

        manager.restartReviewReminders();
        uiManager.uiState = 2;
        await flush();

        expect(uiManager.notifyReviewReminder).not.toHaveBeenCalled();
    });

    test("notifies and opens review for eligible cards", async () => {
        const { manager, uiManager } = setup({
            settings: {
                enableReviewReminders: true,
                reviewReminderCheckOnStartup: true,
                reviewReminderAutoOpen: true,
            },
        });

        manager.restartReviewReminders();
        await flush();

        expect(uiManager.notifyReviewReminder).toHaveBeenCalledTimes(1);
        expect(uiManager.openDeckContainer).toHaveBeenCalledTimes(1);
    });

    test("does not open review when auto-open is disabled", async () => {
        const { manager, uiManager } = setup({
            settings: {
                enableReviewReminders: true,
                reviewReminderCheckOnStartup: true,
                reviewReminderAutoOpen: false,
            },
        });

        manager.restartReviewReminders();
        await flush();

        expect(uiManager.notifyReviewReminder).toHaveBeenCalledTimes(1);
        expect(uiManager.openDeckContainer).not.toHaveBeenCalled();
    });

    test("does not count new cards after today's new-card allowance is spent", async () => {
        const { manager, uiManager } = setup({
            deck: deckWith(new Card()),
            entries: [{ t: Date.now(), r: 3, k: 0, n: 1 }],
            settings: {
                enableReviewReminders: true,
                reviewReminderCheckOnStartup: true,
                dailyLimitsEnabled: true,
                newCardsPerDay: 1,
            },
        });

        manager.restartReviewReminders();
        await flush();

        expect(uiManager.notifyReviewReminder).not.toHaveBeenCalled();
    });

    test("does not count review cards after today's review allowance is spent", async () => {
        const { manager, uiManager } = setup({
            deck: deckWith(dueCard()),
            entries: [{ t: Date.now(), r: 3, k: 1 }],
            settings: {
                enableReviewReminders: true,
                reviewReminderCheckOnStartup: true,
                dailyLimitsEnabled: true,
                reviewsPerDay: 1,
            },
        });

        manager.restartReviewReminders();
        await flush();

        expect(uiManager.notifyReviewReminder).not.toHaveBeenCalled();
    });

    test("still counts learning cards after the review allowance is spent", async () => {
        const { manager, uiManager } = setup({
            deck: deckWith(learningCard()),
            entries: [{ t: Date.now(), r: 3, k: 1 }],
            settings: {
                enableReviewReminders: true,
                reviewReminderCheckOnStartup: true,
                dailyLimitsEnabled: true,
                reviewsPerDay: 1,
            },
        });

        manager.restartReviewReminders();
        await flush();

        expect(uiManager.notifyReviewReminder).toHaveBeenCalledTimes(1);
    });

    test("a restart while a check is running neither runs a second check at once nor lets the old one notify", async () => {
        const { manager, dataManager, uiManager } = setup({
            settings: { enableReviewReminders: true, reviewReminderCheckOnStartup: true },
        });
        let finishSync: () => void = () => undefined;
        let syncs = 0;
        dataManager.sync.mockImplementation(() => {
            syncs++;
            return syncs === 1
                ? new Promise<void>((resolve) => {
                      finishSync = resolve;
                  })
                : Promise.resolve();
        });

        manager.restartReviewReminders(); // check 1 waits for the scan
        await flush();
        manager.restartReviewReminders(); // the reminders are restarted (a setting changed): check 2 begins
        await flush();
        expect(syncs).toBe(2);

        finishSync(); // the old check ends: it belongs to the old reminders and says nothing
        await flush();
        expect(uiManager.notifyReviewReminder).toHaveBeenCalledTimes(1);
    });

    test("a check that was running when the reminders stopped does not notify, and the next one can run", async () => {
        const { manager, dataManager, uiManager } = setup({
            settings: { enableReviewReminders: true, reviewReminderCheckOnStartup: true },
        });
        let finishSync: () => void = () => undefined;
        dataManager.sync.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishSync = resolve;
                }),
        );
        manager.restartReviewReminders();
        await flush();
        manager.stopReviewReminders();
        finishSync();
        await flush();
        expect(uiManager.notifyReviewReminder).not.toHaveBeenCalled();

        manager.restartReviewReminders();
        await flush();
        expect(uiManager.notifyReviewReminder).toHaveBeenCalledTimes(1);
    });
});
