import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.

const manifest = JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as {
    id: string;
};
const pluginId = manifest.id;
const TAB_VIEW = "flashcard-studio-tab-view";
// The numbers of FlashcardReviewMode are a contract: Cram 0, Review 1
const CRAM = 0;
const REVIEW = 1;

interface StudioPlugin {
    isInitialized?: boolean;
    dataManager: {
        data: { settings: Record<string, unknown> };
        settingsManager: { save: () => Promise<void> };
        loadVault: () => Promise<void>;
    };
    uiManager: { contentManager: { reviewMode: number } | null };
}
interface AppWithCommands {
    commands: { executeCommandById: (id: string) => boolean };
}
interface AppWithPlugins {
    plugins: { plugins: Record<string, StudioPlugin | undefined> };
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

/** The mode of the session on screen, or -1 when there is none. */
async function modeOnScreen(): Promise<number> {
    return browser.executeObsidian(({ app }, id) => {
        const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
        return plugin?.uiManager.contentManager?.reviewMode ?? -1;
    }, pluginId);
}

async function studioTabs(): Promise<number> {
    return browser.executeObsidian(
        ({ app }, type) => app.workspace.getLeavesOfType(type).length,
        TAB_VIEW,
    );
}

describe("the Studio tab", function () {
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
        // Review opens as a modal unless it is asked to open as a tab (the setting differs by device)
        await setSetting("openViewInNewTab", true);
        await setSetting("openViewInNewTabMobile", true);
    });

    afterEach(async function () {
        await browser.executeObsidian(({ app }, type) => {
            app.workspace.detachLeavesOfType(type);
        }, TAB_VIEW);
        await browser.keys("Escape");
    });

    after(async function () {
        await setSetting("openViewInNewTab", false);
        await setSetting("openViewInNewTabMobile", false);
    });

    it("opens a session in one tab and scans the vault once for it", async function () {
        const scans = await browser.executeObsidian(async ({ app }, id) => {
            const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
            if (plugin === undefined) throw new Error("the plugin is not loaded");
            const data = plugin.dataManager;
            const original = data.loadVault.bind(data);
            let count = 0;
            data.loadVault = () => {
                count++;
                return original();
            };
            try {
                (app as unknown as AppWithCommands).commands.executeCommandById(
                    `${id}:review-flashcards`,
                );
                // Opening is not awaited by the command; the tab and its queue are ready when the mode is known
                for (let i = 0; i < 100 && plugin.uiManager.contentManager === null; i++) {
                    await new Promise((resolve) => window.setTimeout(resolve, 50));
                }
                await new Promise((resolve) => window.setTimeout(resolve, 500));
            } finally {
                data.loadVault = original;
            }
            return count;
        }, pluginId);

        expect(await studioTabs()).toEqual(1);
        expect(scans).toEqual(1);
    });

    // The bug: with the Studio tab open, a second session only brought the old one to the front
    it("shows the next session when the tab is already open", async function () {
        await browser.executeObsidianCommand(`${pluginId}:review-flashcards`);
        await browser.waitUntil(async () => (await modeOnScreen()) === REVIEW, {
            timeoutMsg: "the review did not open",
        });

        await browser.executeObsidianCommand(`${pluginId}:cram-flashcards`);
        await browser.waitUntil(async () => (await modeOnScreen()) === CRAM, {
            timeoutMsg: "the Studio tab went on showing the old session",
        });
        expect(await studioTabs()).toEqual(1);

        // And back again, so it does not depend on which one came first
        await browser.executeObsidianCommand(`${pluginId}:review-flashcards`);
        await browser.waitUntil(async () => (await modeOnScreen()) === REVIEW, {
            timeoutMsg: "the Studio tab went on showing the old session",
        });
        expect(await studioTabs()).toEqual(1);
    });

    it("leaves no screen behind when the tab is closed", async function () {
        await browser.executeObsidianCommand(`${pluginId}:review-flashcards`);
        await browser.waitUntil(async () => (await modeOnScreen()) === REVIEW);
        await browser.executeObsidian(({ app }, type) => {
            app.workspace.detachLeavesOfType(type);
        }, TAB_VIEW);
        await browser.waitUntil(async () => (await modeOnScreen()) === -1, {
            timeoutMsg: "the plugin kept the screen of a tab that was closed",
        });
    });
});
