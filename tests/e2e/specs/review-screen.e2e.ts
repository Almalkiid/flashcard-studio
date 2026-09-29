import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.
// Set SCREENSHOTS=1 to also save README screenshots of the review screen to docs/media/screenshots.

const pluginId = (JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as { id: string })
    .id;
const SCREENSHOT_DIR = path.resolve("docs/media/screenshots");
const takeScreenshots = process.env.SCREENSHOTS === "1";

interface PluginWithSettings {
    dataManager: {
        data: { settings: Record<string, unknown> };
        settingsManager: { save: () => Promise<void> };
    };
}

async function setSetting(key: string, value: unknown): Promise<void> {
    await browser.executeObsidian(
        async ({ app }, id, settingKey, settingValue) => {
            const plugin = (
                app as unknown as { plugins: { plugins: Record<string, PluginWithSettings> } }
            ).plugins.plugins[id];
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

async function openFirstCard(): Promise<void> {
    await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
    await browser
        .$(".sr-view .sr-card-container .sr-show-answer-button")
        .waitForClickable({ timeoutMsg: "no card was shown" });
}

async function setTheme(light: boolean): Promise<void> {
    await browser.execute((useLight: boolean) => {
        document.body.classList.toggle("theme-light", useLight);
        document.body.classList.toggle("theme-dark", !useLight);
    }, light);
    await browser.pause(150);
}

async function screenshot(name: string): Promise<void> {
    if (!takeScreenshots) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await browser.saveScreenshot(
        path.join(SCREENSHOT_DIR, `${name}-${(await isMobile()) ? "mobile" : "desktop"}.png`),
    );
}

describe("review screen", function () {
    before(async function () {
        await obsidianPage.resetVault();
    });

    beforeEach(async function () {
        await browser.keys("Escape");
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }) => {
                    const file = app.vault.getFileByPath("CIA/Part1/Deck.md");
                    return (app.metadataCache.getFileCache(file)?.tags ?? []).length > 0;
                }),
            { timeoutMsg: "the deck note was never indexed" },
        );
    });

    it("uses the Studio look by default, and Classic when chosen", async function () {
        await openFirstCard();
        const container = browser.$(".sr-view .sr-card-container");
        expect(await container.getAttribute("class")).toContain("sr-look-studio");

        await browser.keys("Escape");
        await setSetting("reviewLook", "classic");
        await openFirstCard();
        expect(await container.getAttribute("class")).toContain("sr-look-classic");
        await setSetting("reviewLook", "studio");
    });

    it("shows the next interval under each answer button", async function () {
        await openFirstCard();
        await browser.$(".sr-view .sr-card-container .sr-show-answer-button").click();
        const good = browser.$(".sr-view .sr-card-container .sr-good-button");
        await good.waitForDisplayed();
        expect(await good.$(".sr-button-label").getText()).toEqual("Good");
        expect(await good.$(".sr-button-interval").getText()).toMatch(/\d/);
    });

    it("key hints match the Anki answer keys on desktop", async function () {
        if (await isMobile()) this.skip();
        await setSetting("answerKeys", "anki");
        await openFirstCard();
        await browser.$(".sr-view .sr-card-container .sr-show-answer-button").click();
        await browser.$(".sr-view .sr-card-container .sr-again-button").waitForDisplayed();

        const hints = await browser.execute(() =>
            ["again", "hard", "good", "easy"].map((rating) => {
                const button = document.querySelector(`.sr-view .sr-${rating}-button`);
                return button ? getComputedStyle(button, "::after").content : "";
            }),
        );
        expect(hints).toEqual(['"1"', '"2"', '"3"', '"4"']);
    });

    it("captures the review screen for the README", async function () {
        if (!takeScreenshots) this.skip();
        for (const light of [false, true]) {
            await setTheme(light);
            await openFirstCard();
            await screenshot(`review-front${light ? "-light" : ""}`);
            await browser.$(".sr-view .sr-card-container .sr-show-answer-button").click();
            await browser.$(".sr-view .sr-card-container .sr-good-button").waitForDisplayed();
            await browser.pause(400);
            await screenshot(`review-back${light ? "-light" : ""}`);
            await browser.keys("Escape");
        }
    });

    it("captures the deck list for the README", async function () {
        if (!takeScreenshots) this.skip();
        await browser.executeObsidianCommand(`${pluginId}:srs-create-sample-deck`);
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }) => {
                    const file = app.vault.getFileByPath("Flashcard Studio/Getting started.md");
                    return (app.metadataCache.getFileCache(file)?.tags ?? []).length > 0;
                }),
            { timeoutMsg: "the sample deck was never indexed" },
        );
        for (const light of [false, true]) {
            await setTheme(light);
            await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
            await browser
                .$(".sr-view .sr-deck-container:not(.sr-is-hidden)")
                .waitForDisplayed({ timeoutMsg: "the deck list was not shown" });
            await browser.pause(300);
            await screenshot(`deck-list${light ? "-light" : ""}`);
            await browser.keys("Escape");
        }
    });
});
