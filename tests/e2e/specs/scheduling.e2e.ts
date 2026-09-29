import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { afterEach, before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.

const manifest = JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as {
    id: string;
};
const pluginId = manifest.id;
const DECK_NOTE = "CIA/Part1/Deck.md";
const DUE_NOTE = "CIA/Part1/Due.md";

interface PluginWithData {
    isInitialized?: boolean;
    dataManager: {
        data: { settings: Record<string, unknown> };
        settingsManager: { save: () => Promise<void> };
    };
}
interface AppWithPlugins {
    plugins: { plugins: Record<string, PluginWithData | undefined> };
}
interface AppWithSettings {
    setting: { open: () => void; close: () => void; openTabById: (id: string) => void };
}

/** The window that holds the notes and the review. On desktop the settings open in a second window. */
let mainWindow = "";

function vaultPath(relative: string): string {
    return path.join(obsidianPage.getVaultPath(), relative);
}

function readNote(relative: string = DECK_NOTE): string {
    return fs.readFileSync(vaultPath(relative), "utf8");
}

async function reviewLogFolder(): Promise<string> {
    return browser.executeObsidian(({ app }, id) => {
        const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id] as PluginWithData;
        return plugin.dataManager.data.settings.reviewLogFolder as string;
    }, pluginId);
}

/** Every JSON line of every review log file, read from disk. */
async function readLogLines(): Promise<Record<string, unknown>[]> {
    const folder = vaultPath(await reviewLogFolder());
    if (!fs.existsSync(folder)) return [];
    const lines: Record<string, unknown>[] = [];
    for (const name of fs.readdirSync(folder).filter((file) => file.endsWith(".md"))) {
        const text = fs.readFileSync(path.join(folder, name), "utf8");
        const body = text.split("```srlog\n")[1] ?? "";
        for (const line of body.split("\n")) {
            if (line.trim().startsWith("{"))
                lines.push(JSON.parse(line) as Record<string, unknown>);
        }
    }
    return lines;
}

async function getSetting(key: string): Promise<unknown> {
    // Reading needs the window that holds the plugin; on desktop the settings are in a second window
    const current = await browser.getWindowHandle();
    const switching = mainWindow !== "" && current !== mainWindow;
    if (switching) await browser.switchToWindow(mainWindow);
    try {
        return await browser.executeObsidian(
            ({ app }, id, settingKey) => {
                const plugin = (app as unknown as AppWithPlugins).plugins.plugins[
                    id
                ] as PluginWithData;
                return plugin.dataManager.data.settings[settingKey];
            },
            pluginId,
            key,
        );
    } finally {
        if (switching) await browser.switchToWindow(current);
    }
}

async function setSetting(key: string, value: unknown): Promise<void> {
    await browser.executeObsidian(
        async ({ app }, id, settingKey, settingValue) => {
            const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id] as PluginWithData;
            plugin.dataManager.data.settings[settingKey] = settingValue;
            await plugin.dataManager.settingsManager.save();
        },
        pluginId,
        key,
        value,
    );
}

async function isMobile(): Promise<boolean> {
    return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

async function openReview(): Promise<void> {
    await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
    await browser
        .$(".sr-view .sr-card-container .sr-show-answer-button")
        .waitForClickable({ timeoutMsg: "card front / Show Answer not shown" });
}

async function showAnswer(): Promise<void> {
    const button = browser.$(".sr-view .sr-card-container .sr-show-answer-button");
    await button.waitForClickable({ timeoutMsg: "Show Answer not shown" });
    await button.click();
    await browser
        .$(".sr-view .sr-card-container .sr-easy-button")
        .waitForDisplayed({ timeoutMsg: "the answer buttons did not appear" });
}

async function answer(buttonClass: string): Promise<void> {
    const button = browser.$(`.sr-view .sr-card-container .${buttonClass}`);
    await button.waitForClickable({ timeoutMsg: `${buttonClass} not shown` });
    await button.click();
}

async function buttonText(buttonClass: string): Promise<string> {
    return browser.$(`.sr-view .sr-card-container .${buttonClass}`).getText();
}

/**
 * Clicks a button in a dialog once it has stopped moving: the emulated phone slides dialogs up as a drawer, and a
 * click during the slide misses the button.
 */
async function clickWhenSettled(selector: string): Promise<void> {
    const element = browser.$(selector);
    await element.waitForClickable({ timeoutMsg: `${selector} is not clickable` });
    await element.waitForStable({ timeoutMsg: `${selector} kept moving` });
    await element.click();
}

/** Closes whatever is open (the settings, the review, then any dialog), so the next step starts from the editor. */
async function closeEverything(): Promise<void> {
    if (mainWindow !== "") {
        await browser.switchToWindow(mainWindow);
        // The settings window, if the test opened one, closes with the settings
    }
    await browser.executeObsidian(({ app }) => (app as unknown as AppWithSettings).setting.close());
    await browser.keys("Escape");
    await browser.keys("Escape");
}

/**
 * Opens the plugin's settings and goes to a settings page, by its name in the plugin's own menu. Desktop Obsidian opens
 * the settings in a second window, so the driver switches to it; the emulated phone shows them in a dialog.
 */
async function openPluginSettingsPage(pageName: string): Promise<void> {
    mainWindow = await browser.getWindowHandle();
    const before = await browser.getWindowHandles();
    await browser.executeObsidian(({ app }, id) => {
        const setting = (app as unknown as AppWithSettings).setting;
        setting.open();
        setting.openTabById(id);
    }, pluginId);

    if (!(await isMobile())) {
        await browser.waitUntil(
            async () => (await browser.getWindowHandles()).length > before.length,
            {
                timeoutMsg: "the settings window did not open",
            },
        );
        const settingsWindow = (await browser.getWindowHandles()).find(
            (handle) => !before.includes(handle),
        );
        await browser.switchToWindow(settingsWindow ?? "");
    }
    // The settings remember the page they were left on, so a later visit may already be on it
    const pageLink = browser.$(`.sr-settings-page-title-setting*=${pageName}`);
    const alreadyThere = browser.$(".sr-settings-page:not(.sr-is-hidden) .sr-fsrs-learning-steps");
    await browser.waitUntil(
        async () => (await pageLink.isDisplayed()) || (await alreadyThere.isDisplayed()),
        { timeoutMsg: `the ${pageName} settings page link is missing` },
    );
    if (await pageLink.isDisplayed()) await pageLink.click();
}

/** Types into a settings text field and leaves it, which saves the value. */
async function typeInto(selector: string, value: string): Promise<void> {
    const input = browser.$(selector);
    await input.waitForClickable({ timeoutMsg: `${selector} not shown` });
    await input.setValue(value);
    // Leaving the field saves it
    await browser.keys("Tab");
}

describe("scheduling settings, custom study, answer keys and postpone", function () {
    before(async function () {
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }, id) => {
                    const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
                    return plugin !== undefined && plugin.isInitialized === true;
                }, pluginId),
            { timeoutMsg: `plugin ${pluginId} did not finish initialising` },
        );
    });

    beforeEach(async function () {
        await obsidianPage.resetVault();
        // The plugin finds cards through Obsidian's metadata cache, which re-indexes the restored note
        // asynchronously; opening a review before that finds no #flashcards tag and no cards.
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }, notePath) => {
                    const file = app.vault.getFileByPath(notePath);
                    const tags = file ? app.metadataCache.getFileCache(file)?.tags : undefined;
                    return (tags ?? []).some((tag) => tag.tag === "#flashcards");
                }, DECK_NOTE),
            { timeoutMsg: "Obsidian never indexed the #flashcards tag of the restored note" },
        );
        await setSetting("dailyLimitsEnabled", false);
    });

    afterEach(async function () {
        await closeEverything();
        // Plugin settings outlive a test, so put back what a test may have changed
        await browser.executeObsidian(async ({ app }, id) => {
            const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id] as unknown as {
                dataManager: {
                    data: { settings: Record<string, unknown>; limitOverride: unknown };
                    settingsManager: { save: () => Promise<void> };
                    refreshAlgorithmParameters: (settings: unknown) => void;
                };
            };
            const data = plugin.dataManager.data;
            Object.assign(data.settings, {
                fsrsLearningSteps: "1m 10m",
                fsrsRelearningSteps: "10m",
                fsrsWeights: "",
                answerKeys: "anki",
                newCardsPerDay: 20,
            });
            data.limitOverride = { date: "", extraNew: 0, extraReviews: 0 };
            await plugin.dataManager.settingsManager.save();
            plugin.dataManager.refreshAlgorithmParameters(data.settings);
        }, pluginId);
    });

    it("a new install starts on FSRS with Anki's answer keys and fuzz on", async function () {
        expect(await getSetting("algorithm")).toEqual("FSRS");
        expect(await getSetting("answerKeys")).toEqual("anki");
        expect(await getSetting("fsrsEnableFuzz")).toEqual(true);
        expect(await getSetting("fsrsLearningSteps")).toEqual("1m 10m");
        expect(await getSetting("fsrsRelearningSteps")).toEqual("10m");
    });

    it("changing the learning steps in the settings changes the next intervals on the buttons", async function () {
        await openReview();
        await showAnswer();
        const againBefore = await buttonText("sr-again-button");
        const goodBefore = await buttonText("sr-good-button");
        expect(againBefore).toMatch(/\b1\s?m/);
        expect(goodBefore).toMatch(/\b10\s?m/);
        await closeEverything();

        await openPluginSettingsPage("Scheduling");
        await typeInto(".sr-fsrs-learning-steps input", "5m 30m");
        await browser.waitUntil(async () => (await getSetting("fsrsLearningSteps")) === "5m 30m", {
            timeoutMsg: "the learning steps setting was never saved",
        });
        await closeEverything();

        // The scheduler was rebuilt while Obsidian kept running: no reload was needed
        await openReview();
        await showAnswer();
        expect(await buttonText("sr-again-button")).toMatch(/\b5\s?m/);
        expect(await buttonText("sr-good-button")).toMatch(/\b30\s?m/);
    });

    it("steps that cannot be read are refused and the saved steps stay", async function () {
        await openPluginSettingsPage("Scheduling");
        await typeInto(".sr-fsrs-learning-steps input", "soon");
        // The field goes back to the saved value
        await browser.waitUntil(
            async () => (await browser.$(".sr-fsrs-learning-steps input").getValue()) === "1m 10m",
            { timeoutMsg: "the field did not go back to the saved steps" },
        );
        expect(await getSetting("fsrsLearningSteps")).toEqual("1m 10m");
    });

    it("custom parameters in an older format are converted to 21 and applied", async function () {
        await openPluginSettingsPage("Scheduling");
        const seventeen =
            "0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61";
        const input = browser.$(".sr-fsrs-weights textarea");
        await input.waitForClickable({ timeoutMsg: "the parameters field is missing" });
        await input.setValue(seventeen);
        await browser.keys("Tab");
        await browser.waitUntil(
            async () => ((await getSetting("fsrsWeights")) as string).split(",").length === 21,
            { timeoutMsg: "the 17 parameters were not converted to 21" },
        );
    });

    it("the answer keys follow the setting: Anki's 1 is Again, the original 1 is Hard", async function () {
        if (await isMobile()) this.skip(); // Keyboard events only reach the review on desktop

        await openReview();
        await showAnswer();
        await browser.keys("1");
        await browser.waitUntil(async () => (await readLogLines()).length === 1, {
            timeoutMsg: "key 1 did not answer the card",
        });
        expect((await readLogLines())[0].r).toEqual(1); // Again

        await showAnswer();
        await browser.keys("4");
        await browser.waitUntil(async () => (await readLogLines()).length === 2, {
            timeoutMsg: "key 4 did not answer the card",
        });
        expect((await readLogLines())[1].r).toEqual(4); // Easy
        await closeEverything();

        await setSetting("answerKeys", "original");
        await openReview();
        await showAnswer();
        await browser.keys("1");
        await browser.waitUntil(async () => (await readLogLines()).length === 3, {
            timeoutMsg: "key 1 did not answer the card with the original keys",
        });
        expect((await readLogLines())[2].r).toEqual(2); // Hard
    });

    it("custom study raises today's new card limit so another new card gets through", async function () {
        await setSetting("dailyLimitsEnabled", true);
        await setSetting("newCardsPerDay", 1);

        await openReview();
        await showAnswer();
        await answer("sr-easy-button");
        await browser.waitUntil(async () => (await readLogLines()).length === 1);
        await browser.waitUntil(
            async () =>
                !(await browser
                    .$(".sr-view .sr-card-container .sr-show-answer-button")
                    .isDisplayed()),
            { timeoutMsg: "a second new card was shown despite a limit of 1" },
        );
        await closeEverything();

        await browser.executeObsidianCommand(`${pluginId}:srs-custom-study`);
        const input = browser.$(".sr-custom-study-increase-new input");
        await input.waitForClickable({ timeoutMsg: "the custom study dialog did not open" });
        await input.setValue("2");
        await clickWhenSettled(".sr-custom-study-increase-new button");
        await browser.waitUntil(
            async () =>
                (await browser.executeObsidian(({ app }, id) => {
                    const plugin = (app as unknown as AppWithPlugins).plugins.plugins[
                        id
                    ] as unknown as {
                        dataManager: { data: { limitOverride: { extraNew: number } } };
                    };
                    return plugin.dataManager.data.limitOverride.extraNew;
                }, pluginId)) === 2,
            { timeoutMsg: "the extra new cards were not recorded" },
        );

        await openReview();
        await showAnswer();
        await answer("sr-easy-button");
        await browser.waitUntil(async () => (await readLogLines()).length === 2, {
            timeoutMsg: "the extra new card was not answered",
        });
    });

    it("a custom study session of new cards previews them without rescheduling", async function () {
        const original = readNote();
        await browser.executeObsidianCommand(`${pluginId}:srs-custom-study`);
        const input = browser.$(".sr-custom-study-preview input");
        await input.waitForClickable({ timeoutMsg: "the custom study dialog did not open" });
        await input.setValue("2");
        await clickWhenSettled(".sr-custom-study-preview button");

        await browser
            .$(".sr-view .sr-card-container .sr-show-answer-button")
            .waitForClickable({ timeoutMsg: "the preview session did not show a card" });
        await showAnswer();
        // A cram session has only Again and Easy
        await browser
            .$(".sr-view .sr-card-container .sr-easy-button")
            .waitForDisplayed({ timeoutMsg: "Easy not shown" });
        expect(await browser.$(".sr-view .sr-card-container .sr-good-button").isDisplayed()).toBe(
            false,
        );
        await answer("sr-easy-button");

        await browser.waitUntil(async () => (await readLogLines()).length === 1, {
            timeoutMsg: "the preview answer was not logged",
        });
        expect((await readLogLines())[0].k).toEqual(3); // cram
        expect(readNote()).toEqual(original);
    });

    it("the deck list has a Custom study button that opens the dialog", async function () {
        await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
        const showAnswerButton = browser.$(".sr-view .sr-card-container .sr-show-answer-button");
        await showAnswerButton.waitForClickable({ timeoutMsg: "card front not shown" });
        // The single deck opens at once; go back to the deck list
        const back = browser.$(".sr-view .sr-card-container .sr-back-button");
        if (await back.isExisting()) {
            if (await back.isDisplayed()) await back.click();
        }
        const button = browser.$(".sr-view .sr-custom-study-button");
        await button.waitForClickable({ timeoutMsg: "the Custom study button is missing" });
        await button.click();
        await browser
            .$(".sr-custom-study-modal")
            .waitForDisplayed({ timeoutMsg: "the Custom study dialog did not open" });
    });

    it("postpone moves a due review card and leaves the rest of the note alone", async function () {
        const overdue = "2020-01-01T09:00:00.000Z";
        const card = `Postponed question::Postponed answer <!--SR:!fsrs,${overdue},10,12.5,5.1,2,4,0,0,2019-12-20T09:00:00.000Z,id=zz9zz9-->`;
        await browser.executeObsidian(
            async ({ app }, notePath, content) => {
                await app.vault.create(notePath, content);
            },
            DUE_NOTE,
            `#flashcards\n\n${card}\n`,
        );
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }, notePath) => {
                    const file = app.vault.getFileByPath(notePath);
                    const tags = file ? app.metadataCache.getFileCache(file)?.tags : undefined;
                    return (tags ?? []).some((tag) => tag.tag === "#flashcards");
                }, DUE_NOTE),
            { timeoutMsg: "Obsidian never indexed the new note" },
        );

        await browser.executeObsidianCommand(`${pluginId}:srs-postpone-due-reviews`);
        const count = browser.$(".sr-postpone-modal .sr-postpone-count");
        await count.waitForDisplayed({ timeoutMsg: "the postpone dialog did not open" });
        expect(await count.getText()).toContain("1 review cards");
        const confirm = browser.$(".sr-postpone-modal button.mod-cta");
        // The phone shows dialogs as a drawer that slides up; a click during the slide misses the button
        await confirm.waitForStable({ timeoutMsg: "the Postpone button kept moving" });
        await confirm.click();

        // A file being rewritten can read as empty for a moment, so wait for a due date that is not the old one
        await browser.waitUntil(
            () => {
                const changed = /!fsrs,([^,]+),/.exec(readNote(DUE_NOTE));
                return changed !== null && changed[1] !== overdue;
            },
            { timeoutMsg: "the due date was never changed" },
        );
        const text = readNote(DUE_NOTE);
        const due = /!fsrs,([^,]+),/.exec(text)?.[1] ?? "";
        // Overdue cards count from the start of today, so the new date is 7 days out (within a day of the time zone)
        const daysAway = (Date.parse(due) - Date.now()) / 86400000;
        expect(daysAway).toBeGreaterThan(5.9);
        expect(daysAway).toBeLessThan(7.1);
        expect(text).toContain("Postponed question::Postponed answer");
        expect(text).toContain("id=zz9zz9");
        // The other note was not touched
        expect(readNote(DECK_NOTE)).not.toContain("<!--SR:");
        // Postponing is not a review, so nothing was logged
        expect(await readLogLines()).toHaveLength(0);

        await browser.executeObsidian(async ({ app }, notePath) => {
            const file = app.vault.getFileByPath(notePath);
            if (file) await app.vault.delete(file);
        }, DUE_NOTE);
    });

    it("exports the review log as the CSV the FSRS optimizer reads", async function () {
        await openReview();
        await showAnswer();
        await answer("sr-good-button");
        await browser.waitUntil(async () => (await readLogLines()).length === 1);
        await closeEverything();

        await browser.executeObsidianCommand(`${pluginId}:srs-export-revlog-csv`);
        await browser.waitUntil(
            () =>
                fs
                    .readdirSync(obsidianPage.getVaultPath())
                    .some((f) => /^flashcard-studio-revlog-.*\.csv$/.test(f)),
            { timeoutMsg: "the CSV was never written to the vault root" },
        );
        const file = fs
            .readdirSync(obsidianPage.getVaultPath())
            .find((f) => /^flashcard-studio-revlog-.*\.csv$/.test(f));
        const lines = fs
            .readFileSync(vaultPath(file ?? ""), "utf8")
            .trim()
            .split("\n");
        expect(lines[0]).toEqual("card_id,review_time,review_rating,review_state,review_duration");
        expect(lines).toHaveLength(2);
        const [cardId, time, rating, state] = lines[1].split(",");
        expect(Number(cardId)).toBeGreaterThan(0);
        expect(Number(time)).toBeGreaterThan(1.7e12);
        expect(rating).toEqual("3");
        expect(state).toEqual("0");
    });

    it("refuses to optimize with too few reviews and says why", async function () {
        await openPluginSettingsPage("Scheduling");
        const optimize = browser.$(".sr-fsrs-optimize");
        await optimize.waitForClickable({ timeoutMsg: "the Optimize button is missing" });
        await optimize.click();
        await clickWhenSettled(".sr-optimizer-modal .sr-optimizer-run");
        const message = browser.$(".sr-optimizer-modal .sr-optimizer-too-few");
        await message.waitForDisplayed({
            timeoutMsg: "the too-few-reviews message did not appear",
        });
        expect(await message.getText()).toContain("at least 400");
    });

    it("optimizes from a review history, shows the fit and applies the new parameters", async function () {
        const logFile = "Flashcard Studio/Review log/2025-01 test-0000.md";
        await browser.executeObsidian(
            async ({ app }, filePath, content) => {
                await app.vault.createFolder("Flashcard Studio").catch(() => undefined);
                await app.vault.createFolder("Flashcard Studio/Review log").catch(() => undefined);
                await app.vault.create(filePath, content);
            },
            logFile,
            syntheticReviewLog(),
        );

        try {
            await openPluginSettingsPage("Scheduling");
            const optimize = browser.$(".sr-fsrs-optimize");
            await optimize.waitForClickable({ timeoutMsg: "the Optimize button is missing" });
            await optimize.click();
            await clickWhenSettled(".sr-optimizer-modal .sr-optimizer-run");

            const summary = browser.$(".sr-optimizer-modal .sr-optimizer-summary");
            await summary.waitForDisplayed({ timeoutMsg: "the optimizer never showed a result" });
            // 70 cards with 8 answers each: 7 answers per card come after the first
            expect(await summary.getText()).toContain("Used 490 reviews of 70 cards");
            expect(await browser.$(".sr-optimizer-modal .sr-optimizer-result").getText()).toContain(
                "Log loss",
            );

            await clickWhenSettled(".sr-optimizer-modal .sr-optimizer-apply");
            await browser.waitUntil(
                async () => ((await getSetting("fsrsWeights")) as string).split(",").length === 21,
                { timeoutMsg: "the optimized parameters were not applied" },
            );
        } finally {
            // Back to the window that holds the vault (desktop settings are in another one)
            await closeEverything();
            await browser.executeObsidian(async ({ app }, filePath) => {
                const file = app.vault.getFileByPath(filePath);
                if (file) await app.vault.delete(file);
            }, logFile);
        }
    });
});

/**
 * A review history in the format of the review log: 70 cards, each answered on 8 days, forgotten far more often than
 * FSRS's default parameters expect, so the optimizer has something to fit.
 */
function syntheticReviewLog(): string {
    const dayMs = 86400000;
    const start = Date.now() - 260 * dayMs;
    const days = [0, 1, 3, 7, 15, 31, 63, 127];
    const lines: string[] = [];
    for (let card = 0; card < 70; card++) {
        days.forEach((day, step) => {
            const forgot = step > 0 && (card + step) % 3 === 0;
            const entry: Record<string, unknown> = {
                t: start + day * dayMs + card * 60000,
                c: `c${String(card).padStart(5, "0")}`,
                r: forgot ? 1 : 3,
                k: step === 0 ? 0 : 1,
                ...(step === 0 ? { n: 1 } : {}),
                ivl: 1,
                li: 1,
                ms: 4000,
                dk: "Deck",
                f: "Deck.md",
            };
            lines.push(JSON.stringify(entry));
        });
    }
    return [
        "---",
        "flashcard-studio: review-log",
        "device: test-0000",
        "---",
        "Review history written by Flashcard Studio. One JSON object per line. Do not edit.",
        "",
        "```srlog",
        ...lines,
        "",
    ].join("\n");
}
