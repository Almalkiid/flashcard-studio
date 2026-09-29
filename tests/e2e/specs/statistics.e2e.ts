import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { afterEach, before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

import { buildDemoLog, buildDemoLogFiles, buildDemoNotes } from "../demo-data";

// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.

const manifest = JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as {
    id: string;
};
const pluginId = manifest.id;
const DECK_NOTE = "CIA/Part1/Deck.md";
const SCREENSHOT_DIR = path.resolve("docs/media/screenshots");
// README screenshots are only (re)written when asked for, so a normal test run leaves the repository unchanged
const TAKE_SCREENSHOTS = process.env.SCREENSHOTS === "1";
const REVIEW_CARD = ".sr-view .sr-card-container";

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

function vaultPath(relative: string): string {
    return path.join(obsidianPage.getVaultPath(), relative);
}

async function reviewLogFolder(): Promise<string> {
    return browser.executeObsidian(({ app }, id) => {
        const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
        if (plugin === undefined) throw new Error("the plugin is not loaded");
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

/**
 * Answering a card buries its question for the rest of the day, in the plugin data, which resetting the vault does
 * not touch. Without this a test would find fewer and fewer cards to review.
 */
async function clearBuryList(): Promise<void> {
    await browser.executeObsidian(async ({ app }, id) => {
        const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
        if (plugin === undefined) throw new Error("the plugin is not loaded");
        (plugin.dataManager.data as unknown as { buryList: string[] }).buryList.length = 0;
        await plugin.dataManager.settingsManager.save();
    }, pluginId);
}

async function isMobile(): Promise<boolean> {
    return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

async function screenshot(name: string): Promise<void> {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    if (TAKE_SCREENSHOTS)
        await browser.saveScreenshot(
            path.join(SCREENSHOT_DIR, `${name}-${(await isMobile()) ? "mobile" : "desktop"}.png`),
        );
}

/** Shows the front of the next card, then its answer. */
async function showAnswer(): Promise<void> {
    const button = browser.$(`${REVIEW_CARD} .sr-show-answer-button`);
    await button.waitForClickable({ timeoutMsg: "card front / Show Answer not shown" });
    await button.click();
}

async function answer(buttonClass: string): Promise<void> {
    const button = browser.$(`${REVIEW_CARD} .${buttonClass}`);
    await button.waitForClickable({ timeoutMsg: `${buttonClass} not shown` });
    await button.click();
}

async function answerNextCard(buttonClass: string): Promise<void> {
    await showAnswer();
    await answer(buttonClass);
}

/**
 * Answers every card of the queue with Easy, until the session summary shows.
 *
 * @returns How many cards were answered.
 */
async function finishSession(): Promise<number> {
    let answered = 0;
    for (let round = 0; round < 12; round++) {
        const next = await browser.waitUntil(
            async () => {
                if (await browser.$(".sr-session-summary").isDisplayed()) return "summary";
                if (await browser.$(`${REVIEW_CARD} .sr-show-answer-button`).isDisplayed()) {
                    return "card";
                }
                return false;
            },
            { timeoutMsg: "neither a card nor the session summary appeared" },
        );
        if (next === "summary") return answered;
        await showAnswer();
        await answer("sr-easy-button");
        answered++;
    }
    throw new Error("the queue never ended");
}

/** Closes every open modal, the review and the card info alike, so the next test starts from a clean screen. */
async function closeModals(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
        if (!(await browser.$(".modal-container").isExisting())) return;
        await browser.keys("Escape");
        await browser.pause(150);
    }
}

async function openReview(command = "srs-review-flashcards"): Promise<void> {
    await browser.executeObsidianCommand(`${pluginId}:${command}`);
}

async function openStatistics(): Promise<void> {
    // Answering rewrites the note, and the plugin finds cards through the re-indexed tags
    await waitForTags([DECK_NOTE]);
    await browser.executeObsidianCommand(`${pluginId}:srs-open-statistics`);
    await browser.$(".sr-stats-view .sr-stats-root").waitForExist({
        timeoutMsg: "the statistics view did not open",
    });
}

/** The text of a statistic in the view, once the view has drawn. */
async function stat(key: string): Promise<string> {
    const element = browser.$(`.sr-stats-view [data-stat="${key}"]`);
    await element.waitForExist({ timeoutMsg: `statistic ${key} was never drawn` });
    return element.getText();
}

async function canvasCount(): Promise<number> {
    return browser.execute(() => document.querySelectorAll(".sr-stats-view canvas").length);
}

async function cardTitles(): Promise<string[]> {
    return browser.execute(() =>
        Array.from(document.querySelectorAll(".sr-stats-view .sr-stats-card-title")).map(
            (title) => title.textContent ?? "",
        ),
    );
}

async function todayKey(): Promise<string> {
    return browser.execute(() => {
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, "0");
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    });
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

/** Waits for Obsidian to index the tags of notes it was just given, which the plugin needs to find their cards. */
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
        { timeoutMsg: "Obsidian never indexed the tags of the new notes" },
    );
}

async function scrollStatistics(top: number): Promise<void> {
    await browser.execute((offset: number) => {
        const root = document.querySelector(".sr-stats-root");
        if (root) root.scrollTop = offset;
    }, top);
    await browser.pause(300);
}

describe("statistics and insight", function () {
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
        await waitForTags([DECK_NOTE]);
        await clearBuryList();
        await setSetting("dailyLimitsEnabled", false);
        await setSetting("openViewInNewTab", false);
        await setSetting("openViewInNewTabMobile", false);
        // A fixed order makes "the first card" the same card in every session
        await setSetting("flashcardCardOrder", "DueFirstSequential");
    });

    afterEach(async function () {
        await closeModals();
        // Close the statistics tab so the next test opens a fresh one
        await browser.executeObsidian(({ app }) => {
            app.workspace.detachLeavesOfType("flashcard-studio-statistics");
            app.workspace.detachLeavesOfType("spaced-repetition-tab-view");
        });
    });

    it("explains that history starts with the next review on a fresh vault", async function () {
        await openStatistics();
        await browser.$(".sr-stats-view .sr-stats-empty").waitForDisplayed({
            timeoutMsg: "the empty state was not shown",
        });
        expect(await browser.$(".sr-stats-view [data-stat='reviews']").isExisting()).toEqual(false);
        // The card based charts still describe the deck
        expect(await stat("total-cards")).toEqual("5");
        expect(await canvasCount()).toBeGreaterThan(0);
        await browser.pause(500);
        await screenshot("statistics-empty");
    });

    it("shows today's numbers, a lit heatmap cell and the charts after answering cards", async function () {
        await openReview();
        await answerNextCard("sr-good-button");
        await answerNextCard("sr-easy-button");
        await answerNextCard("sr-again-button");
        await browser.waitUntil(async () => (await readLogLines()).length === 3, {
            timeoutMsg: "the three answers were never logged",
        });
        await closeModals();

        await openStatistics();
        await browser.waitUntil(async () => (await stat("reviews")) === "3", {
            timeoutMsg: "the reviews of today were not 3",
        });
        expect(await stat("new")).toEqual("3");
        expect(await stat("streak")).toEqual("1");
        expect(await stat("days-studied")).toEqual("1");

        const today = await todayKey();
        const cell = browser.$(`.sr-stats-view .sr-stats-heat-cell[data-day="${today}"]`);
        await cell.waitForExist({ timeoutMsg: "today has no cell in the heatmap" });
        expect(await cell.getAttribute("data-count")).toEqual("3");
        expect(Number(await cell.getAttribute("data-level"))).toBeGreaterThan(0);

        // Tapping a day shows what happened on it. Centre it first, clear of the status bar; WebdriverIO's own
        // scrollIntoView leaves an element alone when it is inside the window, even under the status bar.
        await browser.execute((day: string) => {
            document
                .querySelector(`.sr-stats-view .sr-stats-heat-cell[data-day="${day}"]`)
                ?.scrollIntoView({ block: "center", inline: "center" });
        }, today);
        await cell.click();
        const tooltip = browser.$(".sr-stats-view .sr-stats-tooltip.is-visible");
        await tooltip.waitForExist({ timeoutMsg: "tapping a day did not show its tooltip" });
        // The tooltip fades in, and hidden text has no text to read
        await browser.waitUntil(async () => (await tooltip.getText()).includes("3 reviews on"), {
            timeoutMsg: "the tooltip did not name the reviews of the day",
        });

        // Reviews per day, future due, card counts, stability, difficulty, retrievability and hourly
        expect(await canvasCount()).toBeGreaterThanOrEqual(5);
        expect(await browser.$(".sr-stats-view .sr-stats-empty").isExisting()).toEqual(false);
        await browser.$(".sr-stats-view .sr-stats-retention").waitForExist();
    });

    it("the deck and time range controls change what is counted", async function () {
        const now = Date.now();
        const notes = buildDemoNotes(now);
        const folder = await reviewLogFolder();
        await createFiles([...notes, ...buildDemoLogFiles(folder, buildDemoLog(now))]);
        await waitForTags(notes.map((note) => note.path));

        await openStatistics();
        // 5 fixture cards and 30 Spanish, 20 CIA and 15 anatomy cards
        await browser.waitUntil(async () => (await stat("total-cards")) === "70", {
            timeoutMsg: "the collection did not hold 70 cards",
        });

        const select = browser.$(".sr-stats-view .sr-stats-select");
        await browser
            .$(".sr-stats-view .sr-stats-select option[value='flashcards/anatomy']")
            .waitForExist();
        await select.selectByAttribute("value", "flashcards/anatomy");
        await browser.waitUntil(async () => (await stat("total-cards")) === "15", {
            timeoutMsg: "the anatomy deck did not narrow the cards to 15",
        });
        await select.selectByAttribute("value", "flashcards/spanish");
        await browser.waitUntil(async () => (await stat("total-cards")) === "30");
        await select.selectByAttribute("value", "");
        await browser.waitUntil(async () => (await stat("total-cards")) === "70");

        // A month is drawn per day, a year per week
        await browser.waitUntil(async () => (await cardTitles()).includes("Reviews per day"));
        const year = browser.$(".sr-stats-view .sr-stats-segment[data-value='1y']");
        await year.click();
        expect(await year.getAttribute("aria-pressed")).toEqual("true");
        await browser.waitUntil(async () => (await cardTitles()).includes("Reviews per week"), {
            timeoutMsg: "a year was not drawn per week",
        });
    });

    it("card info shows the state and the whole review history of a card", async function () {
        // Session 1: answer the first card, which gives it an id and a first history row
        await openReview();
        await answerNextCard("sr-good-button");
        await browser.waitUntil(async () => (await readLogLines()).length === 1);
        await closeModals();

        // Cram sessions show the same first card every time and log an answer each, so its history grows.
        // Cram has two buttons, Again and Easy.
        for (const button of [
            "sr-again-button",
            "sr-easy-button",
            "sr-again-button",
            "sr-easy-button",
        ]) {
            await openReview("srs-cram-flashcards");
            await answerNextCard(button);
            await closeModals();
        }
        await browser.waitUntil(async () => (await readLogLines()).length === 5, {
            timeoutMsg: "the cram answers were never logged",
        });

        await openReview("srs-cram-flashcards");
        await browser.$(`${REVIEW_CARD} .sr-show-answer-button`).waitForClickable();
        await browser.executeObsidianCommand(`${pluginId}:srs-card-info`);
        const modal = browser.$(".modal.sr-card-info-modal");
        await modal.waitForDisplayed({ timeoutMsg: "the card info modal did not open" });

        const historyRatings = (): Promise<(string | null)[]> =>
            browser.execute(() =>
                Array.from(document.querySelectorAll(".sr-card-info-table tbody tr")).map((row) =>
                    row.getAttribute("data-rating"),
                ),
            );
        await browser.waitUntil(async () => (await historyRatings()).length === 5, {
            timeoutMsg: "the history did not list the five answers",
        });
        // Newest first: four cram answers, then the first Good (learning)
        const ratings = await historyRatings();
        expect(ratings).toEqual(["4", "1", "4", "1", "3"]);
        expect(await browser.$("[data-field='state']").getText()).toEqual("Learning");
        expect(await browser.$(".sr-card-info-note-link").getText()).toEqual(DECK_NOTE);
        expect(await browser.$(".sr-card-info-front").getText()).toContain(
            "purpose of internal auditing",
        );

        await browser.pause(300);
        await screenshot("card-info");
        await closeModals();
        await modal.waitForExist({
            reverse: true,
            timeoutMsg: "the card info modal did not close",
        });
    });

    it("a new card has no history to show", async function () {
        await openReview();
        await browser.$(`${REVIEW_CARD} .sr-show-answer-button`).waitForClickable();
        await browser.executeObsidianCommand(`${pluginId}:srs-card-info`);
        await browser.$(".modal.sr-card-info-modal").waitForDisplayed();
        expect(await browser.$("[data-field='state']").getText()).toEqual("New");
        expect(await browser.$(".sr-card-info-table").isExisting()).toEqual(false);
        expect(await browser.$(".sr-card-info-history .sr-card-info-hint").getText()).toContain(
            "No reviews recorded",
        );
    });

    it("ends a session with a summary that leads back to the decks or to the statistics", async function () {
        await openReview();
        // The fixture deck has three multi line cards and one line with two clozes
        const answered = await finishSession();
        expect(answered).toBeGreaterThanOrEqual(4);
        const summary = browser.$(".sr-session-summary");
        await summary.waitForDisplayed({ timeoutMsg: "the session summary never appeared" });
        expect(await browser.$(".sr-session-summary [data-stat='cards']").getText()).toEqual(
            String(answered),
        );
        expect(await browser.$(".sr-session-summary [data-stat='streak']").getText()).toContain(
            "1",
        );
        expect(await browser.$(`${REVIEW_CARD} .sr-scroll-wrapper`).isDisplayed()).toEqual(false);

        await browser.pause(700);
        await screenshot("session-summary");

        await browser.$(".sr-session-summary-stats").click();
        await browser.$(".sr-stats-view .sr-stats-root").waitForExist({
            timeoutMsg: "Open statistics did not open the statistics view",
        });
        await browser.waitUntil(async () => (await stat("reviews")) === String(answered));
    });

    it("the session summary also shows when the review opens in a tab", async function () {
        await setSetting("openViewInNewTab", true);
        await setSetting("openViewInNewTabMobile", true);
        await openReview();
        const answered = await finishSession();
        expect(answered).toBeGreaterThanOrEqual(4);
        expect(await browser.$(".sr-session-summary [data-stat='cards']").getText()).toEqual(
            String(answered),
        );
        expect(await browser.$(".sr-modal-content").isExisting()).toEqual(false);

        // There is no modal to close, so the statistics open in a tab of their own
        await browser.$(".sr-session-summary-stats").click();
        await browser
            .$(".sr-stats-view .sr-stats-root")
            .waitForExist({ timeoutMsg: "Open statistics did not open the view" });
        await browser.waitUntil(async () => (await stat("reviews")) === String(answered));
    });

    it("Back to decks leaves the summary for the deck list", async function () {
        await openReview();
        await finishSession();
        await browser.$(".sr-session-summary-back").click();
        await browser.$(".sr-session-summary").waitForExist({ reverse: true });
        expect(await browser.$(".sr-view .sr-deck-container").isDisplayed()).toEqual(true);
    });

    it("the Statistics entry of the settings opens the view and closes the settings", async function () {
        // Obsidian's desktop settings do not open inside the automated window (they never appear in the page),
        // so this runs in the emulated phone, where the same settings page is a modal in the page
        if (!(await isMobile())) this.skip();
        await browser.executeObsidian(({ app }) => {
            (app as unknown as { setting: { open: () => void } }).setting.open();
        });
        await browser
            .$(".modal.mod-settings")
            .waitForExist({ timeoutMsg: "the settings did not open" });
        await browser.executeObsidian(({ app }, id) => {
            (
                app as unknown as { setting: { openTabById: (id: string) => void } }
            ).setting.openTabById(id);
        }, pluginId);
        await browser
            .$(".sr-main-page")
            .waitForExist({ timeoutMsg: "the plugin settings did not open" });
        await browser.execute(() => {
            const rows = Array.from(
                document.querySelectorAll<HTMLElement>(
                    ".sr-main-page .sr-settings-page-title-setting",
                ),
            );
            rows.find((row) => (row.textContent ?? "").includes("Statistics"))?.click();
        });
        await browser.$(".sr-stats-view .sr-stats-root").waitForExist({
            timeoutMsg: "the Statistics entry did not open the view",
        });
        await browser.waitUntil(
            async () => !(await browser.$(".modal.mod-settings").isExisting()),
            {
                timeoutMsg: "the settings stayed open on top of the view",
            },
        );
    });

    it("draws a busy history and a full collection, for the documentation screenshots", async function () {
        const now = Date.now();
        const notes = buildDemoNotes(now);
        const folder = await reviewLogFolder();
        await createFiles([...notes, ...buildDemoLogFiles(folder, buildDemoLog(now))]);
        await waitForTags(notes.map((note) => note.path));

        // Several decks have cards, so the review opens on the deck list; start with the top deck. The Studio look
        // shows its home screen instead of the deck tree, so pick the deck in the classic list.
        await setSetting("reviewLook", "classic");
        await openReview();
        await browser.$(".sr-view .fs-home-deck.is-clickable").waitForClickable({
            timeoutMsg: "the deck list was not shown",
        });
        await browser.execute(() => {
            const rows = Array.from(
                document.querySelectorAll<HTMLElement>(".sr-view .fs-home-deck"),
            );
            rows.find(
                (row) => row.querySelector(".fs-home-deck-name")?.textContent === "Flashcards",
            )?.click();
        });
        // Answer one card, so today has a real review as well as the history
        await answerNextCard("sr-good-button");
        await closeModals();
        await setSetting("reviewLook", "studio");

        const mobile = await isMobile();
        // Give the statistics the whole window on desktop, so the two column layout shows
        if (!mobile) await browser.executeObsidian(({ app }) => app.workspace.leftSplit.collapse());
        await openStatistics();
        await browser.$(".sr-stats-view .sr-stats-heat-cell").waitForExist();
        await browser.waitUntil(async () => (await canvasCount()) >= 7, {
            timeoutMsg: "the charts were not drawn",
        });

        const levels = await browser.execute(
            () =>
                Array.from(document.querySelectorAll(".sr-stats-heat-cell"))
                    .map((cell) => Number(cell.getAttribute("data-level")))
                    .filter((level) => level > 0).length,
        );
        expect(levels).toBeGreaterThan(60);
        expect(Number(await stat("streak"))).toBeGreaterThan(20);

        // Park the pointer on the title, so no chart shows a hover tooltip in the screenshots
        await browser.$(".sr-stats-view .sr-stats-title").moveTo();
        await browser.pause(900);
        // The page is taller than the window, so it is shown in slices from the top
        await scrollStatistics(0);
        await screenshot("statistics");
        const slices = mobile ? [640, 1180, 2400] : [700, 1400, 2100];
        for (const [index, top] of slices.entries()) {
            await scrollStatistics(top);
            if (TAKE_SCREENSHOTS)
                await browser.saveScreenshot(
                    path.join(
                        SCREENSHOT_DIR,
                        `statistics-${mobile ? "mobile" : "desktop"}-${index + 2}.png`,
                    ),
                );
        }

        // The retention tile is the true retention of the last 30 days, and tapping it brings up that table
        const last30 = browser.$(
            ".sr-stats-view .sr-stats-retention tr[data-row='last30'] td:last-child .sr-stats-retention-rate",
        );
        expect(await stat("true-retention")).toEqual(await last30.getText());
        await scrollStatistics(0);
        await browser.$(".sr-stats-view .sr-stats-metric[data-metric='true-retention']").click();
        await browser.waitUntil(
            () =>
                browser.execute(() => {
                    const root = document.querySelector(".sr-stats-root");
                    const card = document.querySelector("[data-section='retention']");
                    if (!root || !card) return false;
                    const offset =
                        card.getBoundingClientRect().top - root.getBoundingClientRect().top;
                    // The last card may not reach the top: then the view is scrolled to its end
                    const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
                    return atEnd
                        ? offset >= 0 && offset < root.clientHeight
                        : Math.abs(offset - 16) < 4;
                }),
            { timeoutMsg: "the retention tile did not scroll to the true retention card" },
        );
        await scrollStatistics(0);
        await browser.$(".sr-stats-view .sr-stats-title").moveTo();

        // A theme change redraws the charts in the new colours. Switching the body classes is what Obsidian does.
        const setLight = (light: boolean) =>
            browser.executeObsidian(({ app }, useLight) => {
                document.body.classList.toggle("theme-light", useLight);
                document.body.classList.toggle("theme-dark", !useLight);
                app.workspace.trigger("css-change");
            }, light);
        await setLight(true);
        await browser.pause(1200);
        await scrollStatistics(0);
        expect(await canvasCount()).toBeGreaterThanOrEqual(7);
        if (TAKE_SCREENSHOTS)
            await browser.saveScreenshot(
                path.join(SCREENSHOT_DIR, `statistics-${mobile ? "mobile" : "desktop"}-light.png`),
            );
        await scrollStatistics(mobile ? 640 : 700);
        if (TAKE_SCREENSHOTS)
            await browser.saveScreenshot(
                path.join(
                    SCREENSHOT_DIR,
                    `statistics-${mobile ? "mobile" : "desktop"}-light-2.png`,
                ),
            );
        await setLight(false);
        if (!mobile) await browser.executeObsidian(({ app }) => app.workspace.leftSplit.expand());
    });
});
