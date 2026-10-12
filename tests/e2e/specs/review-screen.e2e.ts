import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.
// Set SCREENSHOTS=1 to also save README screenshots of the review screen to docs/media/screenshots.

const pluginId = (
    JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as { id: string }
).id;
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

async function isPhone(): Promise<boolean> {
    return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isPhone);
}

async function openFirstCard(): Promise<void> {
    await browser.executeObsidianCommand(`${pluginId}:review-flashcards`);
    await browser
        .$(".fs-view .fs-card-container .fs-show-answer-button")
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
    // Obsidian's notices (such as "Created a sample deck") would cover the top of the screen
    await browser.execute(() => {
        document.querySelectorAll(".notice").forEach((notice) => notice.remove());
    });
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
        const container = browser.$(".fs-view .fs-card-container");
        expect(await container.getAttribute("class")).toContain("fs-look-studio");

        await browser.keys("Escape");
        await setSetting("reviewLook", "classic");
        await openFirstCard();
        expect(await container.getAttribute("class")).toContain("fs-look-classic");
        await setSetting("reviewLook", "studio");
    });

    it("the phone layout follows Obsidian's Platform: raised toolbar buttons on a phone, plain icons on desktop", async function () {
        // Both capabilities must take their own branch, or this would check one side twice
        const phone = await isPhone();
        expect(phone).toBe(await isMobile());

        await openFirstCard();
        const buttons = await browser.$$(".fs-view .fs-card-toolbar .fs-button");
        expect(buttons.length).toBeGreaterThan(0);
        for (const button of buttons) {
            const classes = ((await button.getAttribute("class")) ?? "").split(/\s+/);
            expect(classes.includes("mod-raised")).toBe(phone);
            expect(classes.includes("clickable-icon")).toBe(!phone);
        }
    });

    it("shows the next interval under each answer button", async function () {
        await openFirstCard();
        await browser.$(".fs-view .fs-card-container .fs-show-answer-button").click();
        const good = browser.$(".fs-view .fs-card-container .fs-good-button");
        await good.waitForDisplayed();
        expect(await good.$(".fs-button-label").getText()).toEqual("Good");
        expect(await good.$(".fs-button-interval").getText()).toMatch(/\d/);
    });

    it("a review opened again at once is still a review: the window that closed does not end it", async function () {
        // On a phone a closing window slides away first, and is told that it closed only after the new one opened
        await openFirstCard();
        await browser.keys("Escape");
        await openFirstCard();
        await browser.waitUntil(async () => (await browser.$$(".modal.fs-view").length) === 1, {
            timeoutMsg: "the review that was closed never went away",
        });

        await browser.executeObsidianCommand(`${pluginId}:card-info`);
        await browser
            .$(".modal.fs-card-info-modal")
            .waitForDisplayed({ timeoutMsg: "card info did not open" });
        await browser.keys("Escape");
    });

    it("lists the links in cards in Page preview settings, shown without a key like reading view", async function () {
        const source = await browser.executeObsidian(
            ({ app }) =>
                (
                    app.workspace as unknown as {
                        hoverLinkSources: Record<string, { display: string; defaultMod: boolean }>;
                    }
                ).hoverLinkSources["flashcard-studio"],
        );
        expect(source).toEqual({ display: "Flashcard Studio", defaultMod: false });
    });

    it("key hints match the Anki answer keys on desktop", async function () {
        if (await isMobile()) this.skip();
        await setSetting("answerKeys", "anki");
        await openFirstCard();
        await browser.$(".fs-view .fs-card-container .fs-show-answer-button").click();
        await browser.$(".fs-view .fs-card-container .fs-again-button").waitForDisplayed();

        const hints = await browser.execute(() =>
            ["again", "hard", "good", "easy"].map((rating) => {
                const button = document.querySelector(`.fs-view .fs-${rating}-button`);
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
            await browser.pause(400);
            await screenshot(`review-front${light ? "-light" : ""}`);
            await browser.$(".fs-view .fs-card-container .fs-show-answer-button").click();
            await browser.$(".fs-view .fs-card-container .fs-good-button").waitForDisplayed();
            await browser.pause(400);
            await screenshot(`review-back${light ? "-light" : ""}`);
            await browser.keys("Escape");
        }
    });

    it("captures a session in progress for the README", async function () {
        if (!takeScreenshots) this.skip();
        await obsidianPage.resetVault();
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }) => {
                    const file = app.vault.getFileByPath("CIA/Part1/Deck.md");
                    return (app.metadataCache.getFileCache(file)?.tags ?? []).length > 0;
                }),
            { timeoutMsg: "the deck note was never indexed" },
        );
        await openFirstCard();
        const card = ".fs-view .fs-card-container";
        for (const rating of ["good", "hard", "easy"]) {
            await browser.$(`${card} .fs-show-answer-button`).click();
            await browser.$(`${card} .fs-${rating}-button`).waitForClickable();
            await browser.pause(150);
            await browser.$(`${card} .fs-${rating}-button`).click();
            await browser.$(`${card} .fs-show-answer-button`).waitForClickable();
        }
        await browser.$(`${card} .fs-show-answer-button`).click();
        await browser.$(`${card} .fs-good-button`).waitForDisplayed();
        await browser.pause(500);
        for (const light of [false, true]) {
            await setTheme(light);
            await screenshot(`review-session${light ? "-light" : ""}`);
        }
        await browser.keys("Escape");
    });

    it("captures the deck list for the README", async function () {
        if (!takeScreenshots) this.skip();
        await browser.executeObsidianCommand(`${pluginId}:create-sample-deck`);
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
            await browser.executeObsidianCommand(`${pluginId}:review-flashcards`);
            await browser
                .$(".fs-view .fs-deck-container:not(.fs-is-hidden)")
                .waitForDisplayed({ timeoutMsg: "the deck list was not shown" });
            await browser.pause(300);
            await screenshot(`deck-list${light ? "-light" : ""}`);
            await browser.keys("Escape");
        }
    });
});
