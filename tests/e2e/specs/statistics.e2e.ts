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
const REVIEW_CARD = ".fs-view .fs-card-container";

interface PluginWithData {
    isInitialized?: boolean;
    dataManager: {
        data: { settings: Record<string, unknown> };
        settingsManager: { save: () => Promise<void> };
        refreshAlgorithmParameters: (settings: Record<string, unknown>) => void;
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
            // As the settings screen does, so scheduling settings such as learning steps take effect
            plugin.dataManager.refreshAlgorithmParameters(plugin.dataManager.data.settings);
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
    const button = browser.$(`${REVIEW_CARD} .fs-show-answer-button`);
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
                if (await browser.$(".fs-session-summary").isDisplayed()) return "summary";
                if (await browser.$(`${REVIEW_CARD} .fs-show-answer-button`).isDisplayed()) {
                    return "card";
                }
                return false;
            },
            { timeoutMsg: "neither a card nor the session summary appeared" },
        );
        if (next === "summary") return answered;
        await showAnswer();
        await answer("fs-easy-button");
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

async function openReview(command = "review-flashcards"): Promise<void> {
    await browser.executeObsidianCommand(`${pluginId}:${command}`);
}

async function openStatistics(): Promise<void> {
    // Answering rewrites the note, and the plugin finds cards through the re-indexed tags
    await waitForTags([DECK_NOTE]);
    await browser.executeObsidianCommand(`${pluginId}:open-statistics`);
    await browser.$(".fs-stats-view .fs-stats-root").waitForExist({
        timeoutMsg: "the statistics view did not open",
    });
}

/** The text of a statistic in the view, once the view has drawn. */
async function stat(key: string): Promise<string> {
    const element = browser.$(`.fs-stats-view [data-stat="${key}"]`);
    await element.waitForExist({ timeoutMsg: `statistic ${key} was never drawn` });
    return element.getText();
}

async function canvasCount(): Promise<number> {
    return browser.execute(() => document.querySelectorAll(".fs-stats-view canvas").length);
}

async function cardTitles(): Promise<string[]> {
    return browser.execute(() =>
        Array.from(document.querySelectorAll(".fs-stats-view .fs-stats-card-title")).map(
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
        const root = document.querySelector(".fs-stats-root");
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
        // The default learning steps and learn ahead limit, which a test may change
        await setSetting("fsrsLearningSteps", "1m 10m");
        await setSetting("fsrsRelearningSteps", "10m");
        await setSetting("learnAheadMinutes", 20);
    });

    afterEach(async function () {
        await closeModals();
        // Close the statistics tab so the next test opens a fresh one
        await browser.executeObsidian(({ app }) => {
            app.workspace.detachLeavesOfType("flashcard-studio-statistics");
            app.workspace.detachLeavesOfType("flashcard-studio-tab-view");
        });
    });

    it("explains that history starts with the next review on a fresh vault", async function () {
        await openStatistics();
        await browser.$(".fs-stats-view .fs-stats-empty").waitForDisplayed({
            timeoutMsg: "the empty state was not shown",
        });
        expect(await browser.$(".fs-stats-view [data-stat='reviews']").isExisting()).toEqual(false);
        // The card based charts still describe the deck
        expect(await stat("total-cards")).toEqual("5");
        expect(await canvasCount()).toBeGreaterThan(0);
        await browser.pause(500);
        await screenshot("statistics-empty");
    });

    it("shows today's numbers, a lit heatmap cell and the charts after answering cards", async function () {
        await openReview();
        await answerNextCard("fs-good-button");
        await answerNextCard("fs-easy-button");
        await answerNextCard("fs-again-button");
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
        const cell = browser.$(`.fs-stats-view .fs-stats-heat-cell[data-day="${today}"]`);
        await cell.waitForExist({ timeoutMsg: "today has no cell in the heatmap" });
        expect(await cell.getAttribute("data-count")).toEqual("3");
        expect(Number(await cell.getAttribute("data-level"))).toBeGreaterThan(0);

        // Tapping a day shows what happened on it. Centre it first, clear of the status bar; WebdriverIO's own
        // scrollIntoView leaves an element alone when it is inside the window, even under the status bar.
        await browser.execute((day: string) => {
            document
                .querySelector(`.fs-stats-view .fs-stats-heat-cell[data-day="${day}"]`)
                ?.scrollIntoView({ block: "center", inline: "center" });
        }, today);
        await cell.click();
        const tooltip = browser.$(".fs-stats-view .fs-stats-tooltip.is-visible");
        await tooltip.waitForExist({ timeoutMsg: "tapping a day did not show its tooltip" });
        // The tooltip fades in, and hidden text has no text to read
        await browser.waitUntil(async () => (await tooltip.getText()).includes("3 reviews on"), {
            timeoutMsg: "the tooltip did not name the reviews of the day",
        });

        // Reviews per day, future due, card counts, stability, difficulty, retrievability and hourly
        expect(await canvasCount()).toBeGreaterThanOrEqual(5);
        expect(await browser.$(".fs-stats-view .fs-stats-empty").isExisting()).toEqual(false);
        await browser.$(".fs-stats-view .fs-stats-retention").waitForExist();
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

        // One dropdown per deck level; choosing a deck redraws them, so each is looked up again
        const level = (n: number) =>
            browser.$(`.fs-stats-view .fs-stats-select[data-level='${n}']`);
        await browser
            .$(".fs-stats-view .fs-stats-select[data-level='0'] option[value='flashcards']")
            .waitForExist();
        await level(0).selectByAttribute("value", "flashcards");
        await level(1).waitForExist({ timeoutMsg: "choosing a deck did not offer its subdecks" });
        await level(1).selectByAttribute("value", "flashcards/anatomy");
        await browser.waitUntil(async () => (await stat("total-cards")) === "15", {
            timeoutMsg: "the anatomy deck did not narrow the cards to 15",
        });
        await level(1).selectByAttribute("value", "flashcards/spanish");
        await browser.waitUntil(async () => (await stat("total-cards")) === "30");
        await level(0).selectByAttribute("value", "");
        await browser.waitUntil(async () => (await stat("total-cards")) === "70");
        expect(await level(1).isExisting()).toEqual(false);

        // A month is drawn per day, a year per week
        await browser.waitUntil(async () => (await cardTitles()).includes("Reviews per day"));
        const year = browser.$(".fs-stats-view .fs-stats-segment[data-value='1y']");
        await year.click();
        expect(await year.getAttribute("aria-pressed")).toEqual("true");
        await browser.waitUntil(async () => (await cardTitles()).includes("Reviews per week"), {
            timeoutMsg: "a year was not drawn per week",
        });
    });

    it("the progress card shows each subdeck's mastered share and opens a subdeck when chosen", async function () {
        const now = Date.now();
        const notes = buildDemoNotes(now);
        const folder = await reviewLogFolder();
        await createFiles([...notes, ...buildDemoLogFiles(folder, buildDemoLog(now))]);
        await waitForTags(notes.map((note) => note.path));

        await openStatistics();
        await browser.waitUntil(async () => (await stat("total-cards")) === "70", {
            timeoutMsg: "the collection did not hold 70 cards",
        });
        const rowDecks = async (): Promise<string[]> =>
            browser.execute(() =>
                Array.from(document.querySelectorAll(".fs-stats-view .fs-stats-progress-row")).map(
                    (row) => row.getAttribute("data-deck") ?? "",
                ),
            );
        const level = (n: number) =>
            browser.$(`.fs-stats-view .fs-stats-select[data-level='${n}']`);

        // All decks: one row per top-level deck; choosing a row shows that deck
        await browser.waitUntil(async () => (await rowDecks()).includes("flashcards"), {
            timeoutMsg: "the progress card had no row for the top-level deck",
        });
        await browser.$(".fs-stats-view .fs-stats-progress-row[data-deck='flashcards']").click();
        await browser.waitUntil(async () => (await rowDecks()).includes("flashcards/spanish"), {
            timeoutMsg: "choosing a row did not list its subdecks",
        });
        expect(await rowDecks()).toEqual(
            expect.arrayContaining(["flashcards/spanish", "flashcards/cia", "flashcards/anatomy"]),
        );
        expect(await level(0).getValue()).toEqual("flashcards");
        expect(await level(1).getValue()).toEqual("flashcards");

        // Each row has its mastered share and its counts
        const spanish = browser.$(
            ".fs-stats-view .fs-stats-progress-row[data-deck='flashcards/spanish']",
        );
        expect(await spanish.$(".fs-stats-progress-rate").getText()).toMatch(/^\d+%$/);
        expect(await spanish.$(".fs-stats-progress-details").getText()).toContain("30 cards");

        // The second dropdown goes one level down, and a third offers that deck's own subdecks
        await level(1).selectByAttribute("value", "flashcards/cia");
        await browser.waitUntil(async () => (await rowDecks()).includes("flashcards/cia/part2"), {
            timeoutMsg: "the CIA deck did not list its part",
        });
        await browser.waitUntil(async () => (await stat("total-cards")) === "20");
        expect(await level(2).isExisting()).toEqual(true);
    });

    it("card info shows the state and the whole review history of a card", async function () {
        // Session 1: answer the first card, which gives it an id and a first history row
        await openReview();
        await answerNextCard("fs-good-button");
        await browser.waitUntil(async () => (await readLogLines()).length === 1);
        await closeModals();

        // Cram sessions show the same first card every time and log an answer each, so its history grows.
        // Cram has two buttons, Again and Easy.
        for (const button of [
            "fs-again-button",
            "fs-easy-button",
            "fs-again-button",
            "fs-easy-button",
        ]) {
            await openReview("cram-flashcards");
            await answerNextCard(button);
            await closeModals();
        }
        await browser.waitUntil(async () => (await readLogLines()).length === 5, {
            timeoutMsg: "the cram answers were never logged",
        });

        await openReview("cram-flashcards");
        await browser.$(`${REVIEW_CARD} .fs-show-answer-button`).waitForClickable();
        await browser.executeObsidianCommand(`${pluginId}:card-info`);
        const modal = browser.$(".modal.fs-card-info-modal");
        await modal.waitForDisplayed({ timeoutMsg: "the card info modal did not open" });

        const historyRatings = (): Promise<(string | null)[]> =>
            browser.execute(() =>
                Array.from(document.querySelectorAll(".fs-card-info-table tbody tr")).map((row) =>
                    row.getAttribute("data-rating"),
                ),
            );
        await browser.waitUntil(async () => (await historyRatings()).length === 5, {
            timeoutMsg: "the history did not list the five answers",
        });
        // Newest first: four cram answers, then the first Good (learning)
        const ratings = await historyRatings();
        expect(ratings).toEqual(["4", "1", "4", "1", "3"]);
        expect(await browser.$("[data-field='state']").getText()).toEqual("In learning");
        expect(await browser.$(".fs-card-info-note-link").getText()).toEqual(DECK_NOTE);
        expect(await browser.$(".fs-card-info-front").getText()).toContain(
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
        await browser.$(`${REVIEW_CARD} .fs-show-answer-button`).waitForClickable();
        await browser.executeObsidianCommand(`${pluginId}:card-info`);
        await browser.$(".modal.fs-card-info-modal").waitForDisplayed();
        expect(await browser.$("[data-field='state']").getText()).toEqual("Not started");
        expect(await browser.$(".fs-card-info-table").isExisting()).toEqual(false);
        expect(await browser.$(".fs-card-info-history .fs-card-info-hint").getText()).toContain(
            "No reviews recorded",
        );
    });

    it("ends a session with a summary that leads back to the decks or to the statistics", async function () {
        await openReview();
        // The fixture deck has three multi line cards and one line with two clozes
        const answered = await finishSession();
        expect(answered).toBeGreaterThanOrEqual(4);
        const summary = browser.$(".fs-session-summary");
        await summary.waitForDisplayed({ timeoutMsg: "the session summary never appeared" });
        expect(await browser.$(".fs-session-summary [data-stat='cards']").getText()).toEqual(
            String(answered),
        );
        expect(await browser.$(".fs-session-summary [data-stat='streak']").getText()).toContain(
            "1",
        );
        expect(await browser.$(`${REVIEW_CARD} .fs-scroll-wrapper`).isDisplayed()).toEqual(false);

        await browser.pause(700);
        await screenshot("session-summary");

        await browser.$(".fs-session-summary-stats").click();
        await browser.$(".fs-stats-view .fs-stats-root").waitForExist({
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
        expect(await browser.$(".fs-session-summary [data-stat='cards']").getText()).toEqual(
            String(answered),
        );
        expect(await browser.$(".fs-modal-content").isExisting()).toEqual(false);

        // There is no modal to close, so the statistics open in a tab of their own
        await browser.$(".fs-session-summary-stats").click();
        await browser
            .$(".fs-stats-view .fs-stats-root")
            .waitForExist({ timeoutMsg: "Open statistics did not open the view" });
        await browser.waitUntil(async () => (await stat("reviews")) === String(answered));
    });

    it("shows a missed card again at once when nothing else is left, as Anki's learn ahead limit does", async function () {
        await openReview();
        await answerNextCard("fs-again-button");
        // The missed card is due again in a minute; it comes back instead of a waiting screen
        const answered = await finishSession();
        expect(await browser.$(".fs-session-summary [data-stat='cards']").getText()).toEqual(
            String(answered + 1),
        );
    });

    it("waits for a missed card when the learn ahead limit is 0", async function () {
        await setSetting("learnAheadMinutes", 0);
        await openReview();
        await answerNextCard("fs-again-button");
        await browser.waitUntil(
            async () => {
                const waiting = browser.$(`${REVIEW_CARD} .fs-centered`);
                if (await waiting.isDisplayed()) return true;
                await answerNextCard("fs-easy-button");
                return false;
            },
            { timeoutMsg: "the waiting screen never showed" },
        );
        expect(await browser.$(`${REVIEW_CARD} .fs-centered`).getText()).toContain("Waiting");
    });

    it("offers to review the cards answered Again, then studies only those", async function () {
        const questionShown = () =>
            browser.execute(
                (selector: string) =>
                    Array.from(
                        document.querySelectorAll(
                            `${selector} .fs-content > :not(.fs-context, .fs-reveal-hint)`,
                        ),
                    )
                        .map((element) => element.textContent)
                        .join("\n"),
                REVIEW_CARD,
            );
        // A missed card waits a day instead of coming back after a minute, so the session can end with a mistake in it
        await setSetting("fsrsLearningSteps", "1d");
        await setSetting("fsrsRelearningSteps", "1d");
        await openReview();
        await browser.$(`${REVIEW_CARD} .fs-show-answer-button`).waitForClickable();
        const missed = await questionShown();
        await answerNextCard("fs-again-button");
        await finishSession();

        const mistakes = browser.$(".fs-session-summary-mistakes");
        await mistakes.waitForDisplayed({ timeoutMsg: "Review mistakes was not offered" });
        expect(await mistakes.getText()).toContain("1");
        await browser.pause(700);
        await screenshot("session-summary-mistakes");
        await mistakes.click();

        // Only the missed card comes back
        await browser
            .$(`${REVIEW_CARD} .fs-show-answer-button`)
            .waitForClickable({ timeoutMsg: "the missed card was not shown" });
        expect(await browser.$(`${REVIEW_CARD} .fs-card-counter`).getText()).toEqual("1 / 1");
        expect(await questionShown()).toEqual(missed);

        // Once it is done (custom study is cram: Again or Easy), the normal decks are back
        await answerNextCard("fs-easy-button");
        await browser.waitUntil(
            async () =>
                (await browser.$(".fs-view .fs-deck-container:not(.fs-is-hidden)").isDisplayed()) &&
                (await browser.$(".fs-view .fs-deck-container .fs-title").getText()) === "Decks",
            { timeoutMsg: "the normal decks did not come back after the mistakes" },
        );
    });

    it("Back to decks leaves the summary for the deck list", async function () {
        await openReview();
        await finishSession();
        await browser.$(".fs-session-summary-back").click();
        await browser.$(".fs-session-summary").waitForExist({ reverse: true });
        expect(await browser.$(".fs-view .fs-deck-container").isDisplayed()).toEqual(true);
    });

    it("the back button of the statistics closes them and opens the deck list", async function () {
        // On a phone the statistics replace the deck list, so this button is the only way back to it
        await openStatistics();
        await browser.$(".fs-stats-view .fs-stats-back").click();
        await browser.$(".fs-view .fs-deck-container").waitForDisplayed({
            timeoutMsg: "the deck list did not open",
        });
        const statisticsTabs = await browser.executeObsidian(
            ({ app }) => app.workspace.getLeavesOfType("flashcard-studio-statistics").length,
        );
        expect(statisticsTabs).toEqual(0);
    });

    it("the Open statistics command opens the view, and running it again brings the same one forward", async function () {
        // The settings have no Statistics entry; the view is opened by its command (and from the review screens)
        await openStatistics();
        await openStatistics();
        expect(
            await browser.executeObsidian(
                ({ app }) => app.workspace.getLeavesOfType("flashcard-studio-statistics").length,
            ),
        ).toEqual(1);
    });

    it("draws a busy history and a full collection, for the documentation screenshots", async function () {
        const now = Date.now();
        const notes = buildDemoNotes(now);
        const folder = await reviewLogFolder();
        await createFiles([...notes, ...buildDemoLogFiles(folder, buildDemoLog(now))]);
        await waitForTags(notes.map((note) => note.path));

        // Several decks have cards, so the review opens on the deck list; start with the top deck
        await openReview();
        // The demo CIA deck is remembered least well, under the 90% target, so the home offers it as the focus
        const focus = browser.$(".fs-view .fs-home-focus");
        await focus.waitForDisplayed({ timeoutMsg: "no focus deck was offered" });
        expect(await focus.$(".fs-home-focus-deck").getText()).toEqual("Cia › Part2");
        await browser.pause(300);
        await screenshot("home-focus");
        if (TAKE_SCREENSHOTS) {
            const setBodyTheme = (light: boolean) =>
                browser.execute((useLight: boolean) => {
                    document.body.classList.toggle("theme-light", useLight);
                    document.body.classList.toggle("theme-dark", !useLight);
                }, light);
            await setBodyTheme(true);
            await browser.pause(300);
            await screenshot("home-focus-light");
            await setBodyTheme(false);
        }
        await browser.$(".fs-view .fs-home-deck.is-clickable").waitForClickable({
            timeoutMsg: "the deck list was not shown",
        });
        await browser.execute(() => {
            const rows = Array.from(
                document.querySelectorAll<HTMLElement>(".fs-view .fs-home-deck"),
            );
            rows.find(
                (row) => row.querySelector(".fs-home-deck-name")?.textContent === "Flashcards",
            )?.click();
        });
        // Answer one card, so today has a real review as well as the history
        await answerNextCard("fs-good-button");
        await closeModals();

        const mobile = await isMobile();
        // Give the statistics the whole window on desktop, so the two column layout shows
        if (!mobile) await browser.executeObsidian(({ app }) => app.workspace.leftSplit.collapse());
        await openStatistics();
        await browser.$(".fs-stats-view .fs-stats-heat-cell").waitForExist();
        await browser.waitUntil(async () => (await canvasCount()) >= 7, {
            timeoutMsg: "the charts were not drawn",
        });

        const levels = await browser.execute(
            () =>
                Array.from(document.querySelectorAll(".fs-stats-heat-cell"))
                    .map((cell) => Number(cell.getAttribute("data-level")))
                    .filter((level) => level > 0).length,
        );
        expect(levels).toBeGreaterThan(60);
        expect(Number(await stat("streak"))).toBeGreaterThan(20);

        // Park the pointer on the title, so no chart shows a hover tooltip in the screenshots
        await browser.$(".fs-stats-view .fs-stats-title").moveTo();
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
            ".fs-stats-view .fs-stats-retention tr[data-row='last30'] td:last-child .fs-stats-retention-rate",
        );
        expect(await stat("true-retention")).toEqual(await last30.getText());
        await scrollStatistics(0);
        await browser.$(".fs-stats-view .fs-stats-metric[data-metric='true-retention']").click();
        await browser.waitUntil(
            () =>
                browser.execute(() => {
                    const root = document.querySelector(".fs-stats-root");
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
        await browser.$(".fs-stats-view .fs-stats-title").moveTo();

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
