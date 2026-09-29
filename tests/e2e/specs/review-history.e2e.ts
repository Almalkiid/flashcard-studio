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

function readNote(): string {
    return fs.readFileSync(vaultPath(DECK_NOTE), "utf8");
}

async function reviewLogFolder(): Promise<string> {
    return browser.executeObsidian(({ app }, id) => {
        const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
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
            plugin.dataManager.data.settings[settingKey] = settingValue;
            await plugin.dataManager.settingsManager.save();
        },
        pluginId,
        key,
        value,
    );
}

/**
 * Opens the review and shows the answer of the first card.
 *
 * @returns The card's front, to identify the card later.
 */
async function openReviewAndShowAnswer(): Promise<string> {
    await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
    const showAnswer = browser.$(".sr-view .sr-card-container .sr-show-answer-button");
    await showAnswer.waitForClickable({ timeoutMsg: "card front / Show Answer not shown" });
    const front = await currentCardText();
    await showAnswer.click();
    return front;
}

async function answer(buttonClass: string): Promise<void> {
    const button = browser.$(`.sr-view .sr-card-container .${buttonClass}`);
    await button.waitForClickable({ timeoutMsg: `${buttonClass} not shown` });
    await button.click();
}

/** The rendered card text, without the note-title context line that every card shares. */
async function currentCardText(): Promise<string> {
    return browser.execute(() => {
        const content = document.querySelector(".sr-view .sr-card-container .sr-content");
        if (!content) return "";
        const clone = content.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".sr-context").forEach((element) => element.remove());
        return clone.innerText.trim();
    });
}

async function openCardMenuItem(title: string): Promise<void> {
    const buttons = await browser.$$(
        ".sr-view .sr-card-container .sr-short-menu-button, .sr-view .sr-card-container .sr-extended-menu-button",
    );
    let clicked = false;
    for (const button of buttons) {
        if (await button.isDisplayed()) {
            await button.click();
            clicked = true;
            break;
        }
    }
    expect(clicked).toEqual(true);
    const item = browser.$(`.menu-item*=${title}`);
    await item.waitForClickable({ timeoutMsg: `menu item "${title}" not shown` });
    await item.click();
}

describe("review history and card actions", function () {
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
        if (this.currentTest?.state === "failed") {
            // Keep evidence of what was on screen when a test failed (gitignored)
            const mobile = await browser.executeObsidian(
                ({ obsidian }) => obsidian.Platform.isMobile,
            );
            fs.mkdirSync(path.resolve(".e2e-artifacts"), { recursive: true });
            await browser.saveScreenshot(
                path.resolve(
                    ".e2e-artifacts",
                    `failure-${mobile ? "mobile" : "desktop"}-${Date.now()}.png`,
                ),
            );
            console.log(
                "Failure state:",
                JSON.stringify(
                    await browser.execute(() => ({
                        modals: document.querySelectorAll(".modal-container").length,
                        menus: document.querySelectorAll(".menu").length,
                        views: Array.from(document.querySelectorAll(".sr-view")).map((v) =>
                            (v as HTMLElement).innerText.slice(0, 200),
                        ),
                        deckHidden: Array.from(document.querySelectorAll(".sr-deck-container")).map(
                            (d) => d.classList.contains("sr-is-hidden"),
                        ),
                        cardHidden: Array.from(document.querySelectorAll(".sr-card-container")).map(
                            (d) => d.classList.contains("sr-is-hidden"),
                        ),
                    })),
                ),
            );
        }
        await browser.keys("Escape");
    });

    it("records each answer in this device's review log, linked to the card id", async function () {
        await openReviewAndShowAnswer();
        await answer("sr-good-button");

        await browser.waitUntil(() => /id=[0-9a-z]{6}/.test(readNote()), {
            timeoutMsg: "the note never got a card id",
        });
        const cardId = /id=([0-9a-z]{6})/.exec(readNote())[1];

        await browser.waitUntil(async () => (await readLogLines()).length === 1, {
            timeoutMsg: "the review log never got exactly one entry",
        });
        const [entry] = await readLogLines();
        expect(entry.c).toEqual(cardId);
        expect(entry.r).toEqual(3);
        expect(entry.f).toEqual(DECK_NOTE);

        const folder = vaultPath(await reviewLogFolder());
        const files = fs.readdirSync(folder);
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/^\d{4}-\d{2} [a-z]+-[0-9a-z]{4}\.md$/);
    });

    it("undo from the answer toast restores the note and the log", async function () {
        const original = readNote();
        // Cards come in random order by default, so remember which one was answered
        const answeredFront = await openReviewAndShowAnswer();
        expect(answeredFront.length).toBeGreaterThan(0);
        await answer("sr-easy-button");
        await browser.waitUntil(() => readNote() !== original, {
            timeoutMsg: "the answer was never written",
        });

        const undo = browser.$(".sr-view .sr-answer-toast .sr-answer-toast-undo");
        await undo.waitForClickable({ timeoutMsg: "the answer toast with Undo never appeared" });
        await undo.click();

        await browser.waitUntil(() => readNote() === original, {
            timeoutMsg: "undo did not restore the note byte for byte",
        });
        await browser.waitUntil(async () => (await readLogLines()).length === 0, {
            timeoutMsg: "undo did not remove the log entry",
        });
        await browser.waitUntil(async () => (await currentCardText()) === answeredFront, {
            timeoutMsg: "the undone card was not shown again",
        });
    });

    it("a suspended card is written to the note and not shown again", async function () {
        await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
        await browser
            .$(".sr-view .sr-card-container .sr-show-answer-button")
            .waitForClickable({ timeoutMsg: "card front not shown" });
        const suspended = await currentCardText();
        expect(suspended.length).toBeGreaterThan(0);

        // Desktop menus close at once in an unfocused automated window, so desktop uses the command;
        // the emulated phone exercises the card menu
        const isMobile = await browser.executeObsidian(
            ({ obsidian }) => obsidian.Platform.isMobile,
        );
        if (isMobile) await openCardMenuItem("Suspend card");
        else await browser.executeObsidianCommand(`${pluginId}:srs-suspend-current-card`);
        // A cloze line holds two cards, so the token may be followed by the next segment
        await browser.waitUntil(() => /,susp(-->|!)/.test(readNote()), {
            timeoutMsg: "the suspension was never written to the note",
        });

        await browser.keys("Escape");
        await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
        await browser
            .$(".sr-view .sr-card-container .sr-show-answer-button")
            .waitForClickable({ timeoutMsg: "card front not shown after reopening" });
        // Several cards are left, in random order; the suspended one must not come back in this session
        for (let shown = 0; shown < 6; shown++) {
            const button = browser.$(".sr-view .sr-card-container .sr-show-answer-button");
            if (!(await button.isDisplayed())) break;
            expect(await currentCardText()).not.toEqual(suspended);
            await button.click();
            await answer("sr-easy-button");
        }
    });

    it("the daily new card limit ends the session", async function () {
        await setSetting("dailyLimitsEnabled", true);
        await setSetting("newCardsPerDay", 1);

        await openReviewAndShowAnswer();
        await answer("sr-easy-button");

        await browser.waitUntil(
            async () =>
                !(await browser
                    .$(".sr-view .sr-card-container .sr-show-answer-button")
                    .isDisplayed()),
            { timeoutMsg: "a second new card was shown despite a limit of 1" },
        );
    });

    it("the review log renders as a table and adds no tags", async function () {
        await openReviewAndShowAnswer();
        await answer("sr-good-button");
        await browser.waitUntil(async () => (await readLogLines()).length === 1);
        await browser.keys("Escape");

        const folder = await reviewLogFolder();
        const logPath = await browser.executeObsidian(({ app }, logFolder) => {
            const file = app.vault.getFiles().find((f) => f.path.startsWith(logFolder + "/"));
            return file?.path ?? "";
        }, folder);
        expect(logPath).not.toEqual("");

        await browser.executeObsidian(async ({ app }, filePath) => {
            const leaf = app.workspace.getLeaf(true);
            await leaf.openFile(app.vault.getFileByPath(filePath), { state: { mode: "preview" } });
        }, logPath);
        await browser
            .$(".markdown-reading-view .sr-review-log-table")
            .waitForExist({ timeoutMsg: "the srlog block did not render as a table" });

        const tags = await browser.executeObsidian(({ app }, filePath) => {
            const file = app.vault.getFileByPath(filePath);
            return app.metadataCache.getFileCache(file)?.tags ?? null;
        }, logPath);
        expect(tags).toBeNull();
    });
});
