import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

import { buildDemoLog, buildDemoLogFiles, buildDemoNotes } from "../demo-data";

// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile. On the phone the Studio must not get the
// desktop interface. Set SCREENSHOTS=1 to also save the README screenshots to docs/media/screenshots.

const manifest = JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as {
    id: string;
};
const pluginId = manifest.id;
const DECK_NOTE = "CIA/Part1/Deck.md";
const SCREENSHOT_DIR = path.resolve("docs/media/screenshots");
const TAKE_SCREENSHOTS = process.env.SCREENSHOTS === "1";
const TAB_VIEW = "spaced-repetition-tab-view";
const SHELL = ".fs-desktop-shell";
const CARD = ".sr-view .sr-card-container";

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

async function isMobile(): Promise<boolean> {
    return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

async function setSetting(key: string, value: unknown): Promise<void> {
    await browser.executeObsidian(
        async ({ app }, id, settingKey, settingValue) => {
            const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
            if (plugin === undefined) throw new Error("the plugin is not loaded");
            plugin.dataManager.data.settings[settingKey] = settingValue;
            await plugin.dataManager.settingsManager.save();
        },
        pluginId,
        key,
        value,
    );
}

async function getSetting(key: string): Promise<unknown> {
    return browser.executeObsidian(
        ({ app }, id, settingKey) => {
            const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
            if (plugin === undefined) throw new Error("the plugin is not loaded");
            return plugin.dataManager.data.settings[settingKey];
        },
        pluginId,
        key,
    );
}

/** Answering a card buries its question for the day; without this a test would find fewer and fewer cards. */
async function clearBuryList(): Promise<void> {
    await browser.executeObsidian(async ({ app }, id) => {
        const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
        if (plugin === undefined) throw new Error("the plugin is not loaded");
        (plugin.dataManager.data as unknown as { buryList: string[] }).buryList.length = 0;
        await plugin.dataManager.settingsManager.save();
    }, pluginId);
}

async function createFiles(files: { path: string; content: string }[]): Promise<void> {
    await browser.executeObsidian(async ({ app }, list) => {
        for (const file of list) {
            const parts = file.path.split("/");
            parts.pop();
            let folder = "";
            for (const part of parts) {
                folder = folder ? `${folder}/${part}` : part;
                if (!app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
            }
            const existing = app.vault.getFileByPath(file.path);
            if (existing) await app.vault.modify(existing, file.content);
            else await app.vault.create(file.path, file.content);
        }
    }, files);
}

async function waitForTags(notePaths: string[]): Promise<void> {
    await browser.waitUntil(
        () =>
            browser.executeObsidian(({ app }, paths) => {
                return paths.every((notePath) => {
                    const file = app.vault.getFileByPath(notePath);
                    return (
                        file !== null &&
                        (app.metadataCache.getFileCache(file)?.tags ?? []).length > 0
                    );
                });
            }, notePaths),
        { timeoutMsg: "Obsidian never indexed the tags of the notes" },
    );
}

async function openStudio(): Promise<void> {
    await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
}

async function closeStudio(): Promise<void> {
    await browser.executeObsidian(({ app }, type) => {
        app.workspace.detachLeavesOfType(type);
    }, TAB_VIEW);
    await browser.keys("Escape");
}

/**
 * Sizes the Obsidian window, through Electron (WebDriver's window commands are not available in Obsidian).
 *
 * @returns The size the window has afterwards, which is smaller than asked when the screen is.
 */
async function resizeWindow(width: number, height: number): Promise<[number, number]> {
    await browser.executeObsidian(
        (_context, w, h) => {
            const remote = (
                window as unknown as {
                    require: (id: string) => {
                        getCurrentWindow: () => { setSize: (w: number, h: number) => void };
                    };
                }
            ).require("@electron/remote");
            remote.getCurrentWindow().setSize(w, h);
        },
        width,
        height,
    );
    await browser.pause(400);
    const size = await browser.execute(() => [window.innerWidth, window.innerHeight]);
    return [size[0], size[1]];
}

/** Gives the Studio tab the whole window, so the pane is wide enough for the desktop layout. */
async function useFullWindow(width = 1440, height = 900): Promise<void> {
    await resizeWindow(width, height);
    await browser.executeObsidian(({ app }) => {
        app.workspace.leftSplit.collapse();
        app.workspace.rightSplit.collapse();
    });
    await browser.pause(300);
}

async function setTheme(light: boolean): Promise<void> {
    await browser.execute((useLight: boolean) => {
        document.body.classList.toggle("theme-light", useLight);
        document.body.classList.toggle("theme-dark", !useLight);
    }, light);
    await browser.pause(250);
}

async function screenshot(name: string): Promise<void> {
    if (!TAKE_SCREENSHOTS) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    // Obsidian's notices would cover the top of the screen
    await browser.execute(() => {
        document.querySelectorAll(".notice, .sr-answer-toast").forEach((el) => el.remove());
    });
    await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `${name}.png`));
}

async function showAnswer(): Promise<void> {
    const button = browser.$(`${CARD} .sr-show-answer-button`);
    await button.waitForClickable({ timeoutMsg: "the card front was not shown" });
    await button.click();
}

async function answer(buttonClass: string): Promise<void> {
    const button = browser.$(`${CARD} .${buttonClass}`);
    await button.waitForClickable({ timeoutMsg: `${buttonClass} was not shown` });
    await button.click();
}

/** The text of an element, once it shows something. */
async function textOf(selector: string): Promise<string> {
    return browser.$(selector).getText();
}

/** The text of every element that matches, or the value of one attribute of each. */
async function listOf(selector: string, attribute?: string): Promise<string[]> {
    return browser.execute(
        (css: string, attr: string | null) =>
            Array.from(document.querySelectorAll(css)).map((el) =>
                attr === null ? (el.textContent ?? "") : (el.getAttribute(attr) ?? ""),
            ),
        selector,
        attribute ?? null,
    );
}

describe("desktop interface", function () {
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
        await waitForTags([DECK_NOTE]);
        await clearBuryList();
        // A fixed order makes "the first card" the same card every time
        await setSetting("flashcardCardOrder", "DueFirstSequential");
        await setSetting("dailyLimitsEnabled", false);
        await setSetting("reviewLook", "studio");
        if (!(await isMobile())) {
            await useFullWindow();
            await setTheme(true);
        }
    });

    afterEach(async function () {
        await closeStudio();
    });

    after(async function () {
        if (!(await isMobile())) await resizeWindow(1280, 800);
    });

    it("a fresh install opens the Studio in a tab", async function () {
        if (await isMobile()) this.skip();
        // The default, not something a test set: new installs on desktop start with "Open in new tab" on
        expect(await getSetting("openViewInNewTab")).toEqual(true);
        await openStudio();
        await browser.$(`.workspace-leaf-content[data-type="${TAB_VIEW}"] ${SHELL}`).waitForExist({
            timeoutMsg: "the Studio did not open as a tab with the desktop shell",
        });
    });

    it("the phone does not get the desktop interface", async function () {
        if (!(await isMobile())) this.skip();
        await openStudio();
        // With one deck the review opens on its cards, else on the deck list
        await browser
            .$(
                ".sr-view .sr-deck-container:not(.sr-is-hidden), .sr-view .sr-card-container:not(.sr-is-hidden)",
            )
            .waitForDisplayed({ timeoutMsg: "the review was not shown" });
        expect(await browser.$(SHELL).isExisting()).toEqual(false);
        expect(await browser.$(".fs-desktop-home").isExisting()).toEqual(false);
    });

    it("shows the sidebar, the dashboard home and no side panel", async function () {
        if (await isMobile()) this.skip();
        const now = Date.now();
        const notes = buildDemoNotes(now);
        const folder = (await getSetting("reviewLogFolder")) as string;
        await createFiles([...notes, ...buildDemoLogFiles(folder, buildDemoLog(now))]);
        await waitForTags(notes.map((note) => note.path));

        await openStudio();
        await browser.$(`${SHELL} .fs-desktop-home`).waitForDisplayed({
            timeoutMsg: "the dashboard home was not shown",
        });

        // The sidebar: the navigation with what exists (no Exams or AI yet), the deck tree and Settings
        const labels = await listOf(`${SHELL} .fs-desktop-nav .fs-desktop-nav-item`, "aria-label");
        expect(labels).toEqual(["Home", "Study", "Browse cards", "Statistics"]);
        expect(
            await browser.$(`${SHELL} .fs-desktop-nav-item.is-active`).getAttribute("aria-label"),
        ).toEqual("Home");
        const names = (await listOf(`${SHELL} .fs-desktop-tree .fs-desktop-deck-name`)).map(
            (name) => name.toLowerCase(),
        );
        expect(names).toEqual(expect.arrayContaining(["flashcards", "cia", "spanish", "anatomy"]));
        expect(await browser.$(`${SHELL} .fs-desktop-side`).getSize("width")).toBeCloseTo(244, 0);
        expect(await browser.$(`${SHELL} .fs-desktop-aside`).isDisplayed()).toEqual(false);

        // The home: the greeting, the goal, the strip, the decks table, the activity and the forecast
        expect(await textOf(`${SHELL} .fs-dh-title`)).toMatch(/^Good (morning|afternoon|evening)/);
        expect(await textOf(`${SHELL} .fs-dh-sub`)).toMatch(/cards due, about \d+ min/);
        expect(await browser.$(`${SHELL} .fs-dh-button.is-primary`).getText()).toMatch(
            /^Study all · \d+$/,
        );
        expect(await browser.$(`${SHELL} .fs-dh-button:not(.is-primary)`).isExisting()).toEqual(
            false,
        );
        await browser.waitUntil(async () => (await textOf(`${SHELL} .fs-home-goal-done`)) !== "0", {
            timeoutMsg: "the goal never showed today's answers",
        });
        expect((await listOf(`${SHELL} .fs-dh-deck-row`)).length).toBeGreaterThanOrEqual(3);
        await browser.waitUntil(
            async () => (await textOf(`${SHELL} .fs-dh-deck-row .fs-dh-rate`)) !== "–",
            { timeoutMsg: "the retention of the first deck never showed" },
        );
        await browser.waitUntil(
            async () => (await listOf(`${SHELL} .fs-dh-heat-cell`)).length > 100,
            { timeoutMsg: "the activity grid was not drawn" },
        );
        expect((await listOf(`${SHELL} .fs-dh-bar-col`)).length).toEqual(7);
        expect(await textOf(`${SHELL} .fs-dh-bar-col.is-today .fs-dh-bar-day`)).toEqual("Today");

        // No exam feature yet: no "Last exam" card
        expect(await browser.$(`${SHELL} .fs-dh-exam`).isExisting()).toEqual(false);

        await browser.pause(500);
        await screenshot("desktop-home");
        await setTheme(false);
        await screenshot("desktop-home-dark");
    });

    it("studying collapses the sidebar to a rail, shows the side panel and counts the answers", async function () {
        if (await isMobile()) this.skip();
        const now = Date.now();
        const notes = buildDemoNotes(now);
        const folder = (await getSetting("reviewLogFolder")) as string;
        await createFiles([...notes, ...buildDemoLogFiles(folder, buildDemoLog(now))]);
        await waitForTags(notes.map((note) => note.path));

        await openStudio();
        const study = browser.$(`${SHELL} .fs-dh-deck-row .fs-dh-study`);
        await study.waitForClickable({ timeoutMsg: "no deck offered a Study button" });
        await study.click();

        await browser
            .$(`${SHELL}.is-study`)
            .waitForExist({ timeoutMsg: "the shell did not enter study" });
        await browser.$(`${CARD} .sr-show-answer-button`).waitForClickable();
        expect(await browser.$(`${SHELL} .fs-desktop-side`).getSize("width")).toBeCloseTo(64, 0);
        expect(await browser.$(`${SHELL} .fs-desktop-nav-label`).isDisplayed()).toEqual(false);
        expect(await browser.$(`${SHELL} .fs-desktop-tree`).isDisplayed()).toEqual(false);
        const panel = browser.$(`${SHELL} .fs-study-side-panel`);
        await panel.waitForDisplayed({ timeoutMsg: "the side panel was not shown" });
        expect(await panel.getSize("width")).toBeCloseTo(312, 0);
        expect((await textOf(`${SHELL} .fs-panel-card .fs-panel-title`)).toLowerCase()).toEqual(
            "this card",
        );
        expect((await textOf(`${SHELL} .fs-panel-session .fs-panel-title`)).toLowerCase()).toEqual(
            "this session",
        );
        expect((await textOf(`${SHELL} .fs-panel-keys .fs-panel-title`)).toLowerCase()).toEqual(
            "keys",
        );

        // The top bar: the breadcrumb, "1 / N", and the session clock
        await browser
            .$(`${SHELL} .fs-desktop-clock`)
            .waitForDisplayed({ timeoutMsg: "no session clock" });
        expect(await textOf(`${SHELL} .fs-card-counter`)).toMatch(/^1 \/ \d+$/);
        expect(await textOf(`${SHELL} .fs-desktop-clock-text`)).toMatch(/^\d\d:\d\d$/);

        // Answer two cards; the session block counts them
        await showAnswer();
        await answer("sr-good-button");
        await browser.$(`${CARD} .sr-show-answer-button`).waitForClickable();
        await showAnswer();
        await answer("sr-again-button");
        await browser.$(`${CARD} .sr-show-answer-button`).waitForClickable();
        await browser.waitUntil(
            async () =>
                (await textOf(`${SHELL} .fs-panel-tile.is-good b`)) === "1" &&
                (await textOf(`${SHELL} .fs-panel-tile.is-again b`)) === "1" &&
                (await textOf(`${SHELL} .fs-panel-tile.is-hard b`)) === "0",
            { timeoutMsg: "the session block did not count the two answers" },
        );
        expect(await textOf(`${SHELL} .fs-card-counter`)).toMatch(/^3 \/ \d+$/);

        // The card on screen: its state and lapses are known
        expect(await textOf(`${SHELL} .fs-panel-card .fs-panel-rows`)).toContain("State");

        // The back of a card, with the tiles under it
        await showAnswer();
        await browser.$(`${CARD} .sr-good-button`).waitForDisplayed();
        await browser.pause(600);
        await screenshot("desktop-study");
        await setTheme(false);
        await screenshot("desktop-study-dark");
        await setTheme(true);

        // Home goes back to the dashboard, with the sidebar open again
        await browser.$(`${SHELL} .fs-desktop-nav-item[aria-label="Home"]`).click();
        await browser.$(`${SHELL} .fs-desktop-home`).waitForDisplayed();
        expect(await browser.$(SHELL).getAttribute("class")).not.toContain("is-study");
        expect(await browser.$(`${SHELL} .fs-desktop-side`).getSize("width")).toBeCloseTo(244, 0);
    });

    it("the answer keys work in the tab", async function () {
        if (await isMobile()) this.skip();
        await setSetting("answerKeys", "anki");
        await openStudio();
        await browser.$(`${SHELL} .fs-desktop-home`).waitForDisplayed();
        await browser.$(`${SHELL} .fs-dh-button.is-primary`).click();
        await browser.$(`${CARD} .sr-show-answer-button`).waitForClickable();

        // Space shows the answer, 3 answers Good, as in Anki
        await browser.keys(" ");
        await browser.$(`${CARD} .sr-good-button`).waitForDisplayed({
            timeoutMsg: "Space did not show the answer",
        });
        await browser.keys("3");
        await browser.waitUntil(
            async () => (await textOf(`${SHELL} .fs-panel-tile.is-good b`)) === "1",
            { timeoutMsg: "the 3 key did not answer Good" },
        );
    });

    it("the deck tree studies a deck, and opens and closes its subdecks", async function () {
        if (await isMobile()) this.skip();
        const now = Date.now();
        const notes = buildDemoNotes(now);
        await createFiles(notes);
        await waitForTags(notes.map((note) => note.path));
        await openStudio();
        await browser.$(`${SHELL} .fs-desktop-tree .fs-desktop-deck`).waitForDisplayed();

        // "flashcards" is the top level and starts open, so "cia" shows under it and "part2" is not there
        const decksAt = (level: number) =>
            listOf(`${SHELL} .fs-desktop-tree [aria-level="${level}"] .fs-desktop-deck-name`);
        const chevron = browser.$(
            `${SHELL} .fs-desktop-tree [aria-level="1"] .fs-desktop-deck-chevron`,
        );
        expect(await browser.$(`${SHELL} .fs-desktop-tree [aria-level="2"]`).isDisplayed()).toEqual(
            true,
        );
        await chevron.click();
        await browser.waitUntil(
            async () =>
                !(await browser.$(`${SHELL} .fs-desktop-tree [aria-level="2"]`).isDisplayed()),
            { timeoutMsg: "the top deck did not close" },
        );
        await chevron.click();
        await browser.$(`${SHELL} .fs-desktop-tree [aria-level="2"]`).waitForDisplayed();
        expect(await decksAt(2)).toEqual(["Anatomy", "Cia", "Spanish"]);

        // A click on a deck studies it
        await browser.execute(() => {
            const rows = Array.from(
                document.querySelectorAll<HTMLElement>(
                    ".fs-desktop-tree [aria-level='2'] .fs-desktop-deck-name",
                ),
            );
            rows.find((row) => row.textContent === "Spanish")?.click();
        });
        await browser.$(`${SHELL}.is-study`).waitForExist();
        await browser.$(`${CARD} .sr-show-answer-button`).waitForClickable();
        expect(await textOf(`${SHELL} .fs-card-title-deck`)).toContain("Spanish");
    });

    it("the end of a session shows its summary inside the shell", async function () {
        if (await isMobile()) this.skip();
        const now = Date.now();
        const notes = buildDemoNotes(now);
        await createFiles(notes);
        await waitForTags(notes.map((note) => note.path));
        await openStudio();
        await browser.execute(() => {
            const rows = Array.from(
                document.querySelectorAll<HTMLElement>(
                    ".fs-desktop-tree [aria-level='2'] .fs-desktop-deck-name",
                ),
            );
            rows.find((row) => row.textContent === "Anatomy")?.click();
        });
        // Answer every card of the deck, then the summary shows
        for (let round = 0; round < 12; round++) {
            const next = await browser.waitUntil(
                async () => {
                    if (await browser.$(".sr-session-summary").isDisplayed()) return "summary";
                    if (await browser.$(`${CARD} .sr-show-answer-button`).isDisplayed())
                        return "card";
                    return false;
                },
                { timeoutMsg: "neither a card nor the summary appeared" },
            );
            if (next === "summary") break;
            await showAnswer();
            await answer("sr-easy-button");
        }
        await browser.$(".sr-session-summary").waitForDisplayed();
        expect(await browser.$(`${SHELL}.is-study`).isExisting()).toEqual(true);
        expect(await browser.$(`${SHELL} .fs-study-side-panel`).isDisplayed()).toEqual(true);
    });

    it("keeps the phone layout in a narrow pane, and switches back when the pane widens", async function () {
        if (await isMobile()) this.skip();
        await openStudio();
        await browser.$(`${SHELL} .fs-desktop-home`).waitForDisplayed();

        await resizeWindow(800, 900);
        await browser.waitUntil(async () => !(await browser.$(SHELL).isExisting()), {
            timeoutMsg: "a narrow pane kept the desktop shell",
        });
        await browser.$(".sr-view .fs-home, .sr-view .sr-card-container").waitForExist();

        await resizeWindow(1440, 900);
        await browser.$(`${SHELL} .fs-desktop-home`).waitForDisplayed({
            timeoutMsg: "a wide pane did not bring the desktop shell back",
        });
    });

    it("the Classic look keeps its own layout", async function () {
        if (await isMobile()) this.skip();
        await setSetting("reviewLook", "classic");
        await openStudio();
        // With one deck the review opens on its cards, else on the deck list
        await browser
            .$(
                ".sr-view .sr-deck-container:not(.sr-is-hidden), .sr-view .sr-card-container:not(.sr-is-hidden)",
            )
            .waitForDisplayed({ timeoutMsg: "the review was not shown" });
        expect(await browser.$(SHELL).isExisting()).toEqual(false);
    });

    it("a saved choice of the modal is kept", async function () {
        if (await isMobile()) this.skip();
        await setSetting("openViewInNewTab", false);
        await openStudio();
        await browser.$(".modal-container .sr-view").waitForExist({
            timeoutMsg: "the modal did not open",
        });
        expect(await browser.$(SHELL).isExisting()).toEqual(false);
        await setSetting("openViewInNewTab", true);
    });
});
