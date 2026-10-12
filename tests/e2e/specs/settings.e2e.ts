import { browser, expect } from "@wdio/globals";
import { afterEach, before, describe, it } from "mocha";

import {
    addListItem,
    clickToggle,
    clickWhenSettled,
    closeSettings,
    deleteListItem,
    entryValue,
    getSetting,
    goBack,
    inMainWindow,
    isMobile,
    openPage,
    openSettings,
    pageTitle,
    pluginId,
    row,
    rowError,
    rowHasClass,
    typeInto,
} from "../settings-helpers";

// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.
//
// The settings are Obsidian's own declarative settings. These tests drive them as a person does, in the real app, and
// check what ends up in the plugin's data, and that the rows follow a change without opening the settings again.

interface PluginWithData {
    isInitialized?: boolean;
    removeCustomHotkeys: () => void;
    dataManager: {
        data: { settings: Record<string, unknown>; buryList: string[] };
        settingsManager: { save: () => Promise<void> };
        setupDataStoreAndAlgorithmInstances: (settings: unknown) => void;
    };
}
interface AppWithPlugins {
    plugins: { plugins: Record<string, PluginWithData | undefined> };
}

/** The settings as they were when the spec started, put back after every test. */
let baseline: Record<string, unknown> = {};

/** The bury list, and whether this is still the plugin instance that Reset all settings was started on. */
async function readBuryState(): Promise<{ same: boolean; buryList: string[] }> {
    return inMainWindow(() =>
        browser.executeObsidian(({ app }, id) => {
            const plugin = (app as unknown as AppWithPlugins).plugins.plugins[
                id
            ] as PluginWithData & { e2eSameInstance?: boolean };
            return {
                same: plugin.e2eSameInstance === true,
                buryList: plugin.dataManager.data.buryList,
            };
        }, pluginId),
    );
}

async function hasCommand(commandId: string): Promise<boolean> {
    return inMainWindow(() =>
        browser.executeObsidian(
            ({ app }, id) =>
                id in (app as unknown as { commands: { commands: object } }).commands.commands,
            commandId,
        ),
    );
}

/** Picks an algorithm in the dropdown and confirms the dialog that asks first. */
async function switchAlgorithm(value: "FSRS" | "SM-2-OSR"): Promise<void> {
    const dropdown = row("Algorithm").$("select");
    await dropdown.waitForClickable({ timeoutMsg: "the Algorithm dropdown is not shown" });
    await dropdown.selectByAttribute("value", value);
    await clickWhenSettled(".fs-confirmation-modal-button-container button.mod-warning");
    await browser.waitUntil(async () => (await getSetting("algorithm")) === value, {
        timeoutMsg: `the algorithm did not change to ${value}`,
    });
}

describe("settings", function () {
    before(async function () {
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }, id) => {
                    const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
                    return plugin !== undefined && plugin.isInitialized === true;
                }, pluginId),
            { timeoutMsg: `plugin ${pluginId} did not finish initialising` },
        );
        baseline = await browser.executeObsidian(
            ({ app }, id) =>
                JSON.parse(
                    JSON.stringify(
                        (app as unknown as AppWithPlugins).plugins.plugins[id]?.dataManager.data
                            .settings,
                    ),
                ) as Record<string, unknown>,
            pluginId,
        );
    });

    afterEach(async function () {
        await closeSettings();
        await browser.keys("Escape");
        // Settings outlive a test, so put back what a test changed, and what the changes switched on
        await browser.executeObsidian(
            async ({ app }, id, values) => {
                const plugin = (app as unknown as AppWithPlugins).plugins.plugins[
                    id
                ] as PluginWithData;
                const { data, settingsManager } = plugin.dataManager;
                const algorithmChanged = data.settings.algorithm !== values.algorithm;
                Object.assign(data.settings, values);
                data.buryList = [];
                await settingsManager.save();
                if (algorithmChanged)
                    plugin.dataManager.setupDataStoreAndAlgorithmInstances(data.settings);
                plugin.removeCustomHotkeys();
            },
            pluginId,
            baseline,
        );
    });

    it("shows every group in order, none called settings, and no Statistics row", async function () {
        await openSettings();
        const headings = await browser.execute(() =>
            Array.from(
                document.querySelectorAll(
                    ".vertical-tab-content .setting-item-heading .setting-item-name",
                ),
            ).map((element) => element.textContent ?? ""),
        );
        expect(headings).toEqual([
            "Studying",
            "Scheduling",
            "Card formats",
            "Note review",
            "Display",
            "Reminders",
            "AI cards",
            "Data",
            "Delete schedules",
            "Reset",
            "Developer",
            "Help",
        ]);
        expect(headings.some((heading) => /settings/i.test(heading))).toBe(false);
        // Statistics is opened by its command, not from the settings
        expect(await row("Statistics").isExisting()).toBe(false);
    });

    it("Obsidian's settings search finds Desired retention when searching retention", async function () {
        await openSettings(false);
        const search = browser.$(".setting-search-container input");
        await search.waitForClickable({ timeoutMsg: "the settings search box is not shown" });
        await search.setValue("retention");
        const hit = browser.$(
            '//div[contains(@class, "setting-search-result-item")][.//div[contains(@class, "vertical-tab-nav-item-title")][contains(normalize-space(), "Desired retention")]]',
        );
        await hit.waitForDisplayed({ timeoutMsg: "the search did not find Desired retention" });
        // Opening the result goes to the row in the plugin's settings
        await hit.waitForStable({ timeoutMsg: "the search result kept moving" });
        await hit.click();
        await row("Desired retention (%)").waitForDisplayed({
            timeoutMsg: "the result did not open the Desired retention row",
        });
    });

    it("an invalid time shows the error and is not saved; a valid one is stored as HH:MM:SS", async function () {
        const original = await getSetting("startOfDay");
        await openSettings();
        await typeInto("Next day starts at", "24:00");
        await browser.waitUntil(async () => (await rowError("Next day starts at")) !== "", {
            timeoutMsg: "no error was shown for 24:00",
        });
        expect(await rowError("Next day starts at")).toEqual("Use 24-hour time, such as 04:00.");
        expect(await rowHasClass("Next day starts at", "is-invalid")).toBe(true);
        expect(await getSetting("startOfDay")).toEqual(original);

        await typeInto("Next day starts at", "04:00");
        await browser.waitUntil(async () => (await getSetting("startOfDay")) === "04:00:00", {
            timeoutMsg: "04:00 was not stored as 04:00:00",
        });
        expect(await rowError("Next day starts at")).toEqual("");
        expect(await rowHasClass("Next day starts at", "is-invalid")).toBe(false);
    });

    it("Reset all settings puts the options back at once and leaves the bury list alone", async function () {
        await inMainWindow(() =>
            browser.executeObsidian(async ({ app }, id) => {
                const plugin = (app as unknown as AppWithPlugins).plugins.plugins[
                    id
                ] as PluginWithData & { e2eSameInstance?: boolean };
                plugin.dataManager.data.buryList = ["e2e-buried-card"];
                plugin.e2eSameInstance = true;
                await plugin.dataManager.settingsManager.save();
            }, pluginId),
        );
        await openSettings();
        await typeInto("New cards per day", "5");
        await browser.waitUntil(async () => (await getSetting("newCardsPerDay")) === 5, {
            timeoutMsg: "5 new cards per day was not stored",
        });
        await switchAlgorithm("SM-2-OSR");

        await row("Reset all settings").click();
        await clickWhenSettled(".fs-confirmation-modal-button-container button.mod-warning");
        await browser.waitUntil(
            async () =>
                (await getSetting("newCardsPerDay")) === 20 &&
                (await getSetting("algorithm")) === "FSRS",
            { timeoutMsg: "the settings were not put back" },
        );

        // The open settings follow: the field is back at 20 and the FSRS rows are back. The field is redrawn a
        // moment after the stored value changes, so wait for it.
        await browser.waitUntil(
            async () => (await row("New cards per day").$("input").getValue()) === "20",
            { timeoutMsg: "the New cards per day field did not go back to 20" },
        );
        await row("Desired retention (%)").waitForDisplayed({
            timeoutMsg: "the FSRS rows did not come back after the reset",
        });
        // No reload: this is the plugin that was running before, and it still holds the bury list
        expect(await readBuryState()).toEqual({ same: true, buryList: ["e2e-buried-card"] });
    });

    it("clearing a number field puts the default back instead of saving 0", async function () {
        await openSettings();
        await typeInto("Maximum interval (days)", "100");
        await browser.waitUntil(async () => (await getSetting("maximumInterval")) === 100, {
            timeoutMsg: "100 days was not stored",
        });

        await typeInto("Maximum interval (days)", "");
        await browser.waitUntil(async () => (await getSetting("maximumInterval")) === 36525, {
            timeoutMsg: "clearing the field did not put the default back",
        });
        expect(await rowError("Maximum interval (days)")).toEqual("");
    });

    it("Open in a tab is hidden while the desktop layout already opens the review as a tab", async function () {
        await openSettings();
        await row("Open in a tab").waitForDisplayed({ timeoutMsg: "Open in a tab is not shown" });
        if (await isMobile()) return; // A phone never has the desktop layout, so the row stays

        await clickToggle("Desktop layout");
        await browser.waitUntil(async () => !(await row("Open in a tab").isDisplayed()), {
            timeoutMsg: "Open in a tab stayed after the desktop layout was turned on",
        });
        await clickToggle("Desktop layout");
        await row("Open in a tab").waitForDisplayed({
            timeoutMsg: "Open in a tab did not come back after the desktop layout was turned off",
        });
    });

    it("custom hotkeys add their commands when on and leave none when off (desktop)", async function () {
        if (await isMobile()) this.skip(); // Only a computer has hotkeys, and the review there opens in a tab
        const good = `${pluginId}:card-review-good`;
        expect(await hasCommand(good)).toBe(false);

        await openSettings();
        // The review opens as a pop-up in these tests, and hotkeys only work in a tab
        expect(await rowHasClass("Custom hotkeys", "is-disabled")).toBe(true);
        await clickToggle("Open in a tab");
        await browser.waitUntil(async () => !(await rowHasClass("Custom hotkeys", "is-disabled")), {
            timeoutMsg: "Custom hotkeys stayed disabled after Open in a tab was turned on",
        });

        await clickToggle("Custom hotkeys");
        await browser.waitUntil(() => hasCommand(good), {
            timeoutMsg: "turning on custom hotkeys did not add the answer commands",
        });
        await clickToggle("Custom hotkeys");
        await browser.waitUntil(async () => !(await hasCommand(good)), {
            timeoutMsg: "turning off custom hotkeys left the answer commands behind",
        });
    });

    it("custom hotkeys turn off when the review stops opening in a tab (desktop)", async function () {
        if (await isMobile()) this.skip();
        const good = `${pluginId}:card-review-good`;
        await openSettings();
        await clickToggle("Open in a tab");
        await browser.waitUntil(async () => !(await rowHasClass("Custom hotkeys", "is-disabled")));
        await clickToggle("Custom hotkeys");
        await browser.waitUntil(() => hasCommand(good));

        await clickToggle("Open in a tab");
        await browser.waitUntil(async () => (await getSetting("useCustomHotkeys")) === false, {
            timeoutMsg: "custom hotkeys stayed on after the review stopped opening in a tab",
        });
        expect(await hasCommand(good)).toBe(false);
        await browser.waitUntil(async () => await rowHasClass("Custom hotkeys", "is-disabled"), {
            timeoutMsg: "the Custom hotkeys row did not go back to disabled",
        });
    });

    it("changing the algorithm shows and hides rows without opening the settings again", async function () {
        await openSettings();
        const fsrsOnly = ["Desired retention (%)", "Optimize parameters", "Advanced FSRS"];
        for (const name of fsrsOnly) expect(await row(name).isDisplayed()).toBe(true);
        expect(await row("SM-2").isDisplayed()).toBe(false);

        await switchAlgorithm("SM-2-OSR");
        await row("SM-2").waitForDisplayed({ timeoutMsg: "the SM-2 page did not appear" });
        for (const name of fsrsOnly) {
            await browser.waitUntil(async () => !(await row(name).isDisplayed()), {
                timeoutMsg: `${name} stayed after the switch to SM-2`,
            });
        }
        // The dropdown shows the algorithm in use
        expect(await row("Algorithm").$("select").getValue()).toEqual("SM-2-OSR");

        await switchAlgorithm("FSRS");
        for (const name of fsrsOnly) {
            await row(name).waitForDisplayed({ timeoutMsg: `${name} did not come back` });
        }
        await browser.waitUntil(async () => !(await row("SM-2").isDisplayed()), {
            timeoutMsg: "the SM-2 page stayed after the switch back",
        });
    });

    it("turning review reminders on enables their options", async function () {
        await openSettings();
        const options = ["Check every (minutes)", "Check at startup", "Reminder text"];
        for (const name of options) expect(await rowHasClass(name, "is-disabled")).toBe(true);

        await clickToggle("Review reminders");
        for (const name of options) {
            await browser.waitUntil(async () => !(await rowHasClass(name, "is-disabled")), {
                timeoutMsg: `${name} stayed disabled after reminders were turned on`,
            });
        }
        await clickToggle("Review reminders");
        for (const name of options) {
            await browser.waitUntil(async () => await rowHasClass(name, "is-disabled"), {
                timeoutMsg: `${name} stayed enabled after reminders were turned off`,
            });
        }
    });

    it("editing inside a page updates what its entry shows when you go back", async function () {
        await openSettings();
        expect(await entryValue("Leeches")).toEqual("After 8 lapses");

        await openPage("Leeches");
        await typeInto("Lapses to become a leech", "5");
        await browser.waitUntil(async () => (await getSetting("leechThreshold")) === 5);
        await goBack();
        expect(await entryValue("Leeches")).toEqual("After 5 lapses");

        await openPage("Answer button labels");
        await typeInto("Again", "Oops");
        await browser.waitUntil(async () => (await getSetting("flashcardAgainText")) === "Oops");
        await goBack();
        expect(await entryValue("Answer button labels")).toEqual("Oops, Hard, Good, Easy");
    });

    it("adding and removing a skipped folder keeps the page usable and its count right", async function () {
        await openSettings();
        expect(await entryValue("Skipped folders")).toEqual("1 folder");
        await openPage("Skipped folders");

        await addListItem("Add folder");
        const input = browser.$(".fs-text-prompt-input");
        await input.waitForClickable({ timeoutMsg: "the Skip a folder dialog did not open" });
        await input.setValue("Templates");
        await clickWhenSettled(".modal-container button.mod-cta");
        await browser.waitUntil(
            async () =>
                ((await getSetting("noteFoldersToIgnore")) as string[]).includes("Templates"),
            { timeoutMsg: "the folder was not stored" },
        );
        await row("Templates").waitForDisplayed({
            timeoutMsg: "the new folder is not in the list",
        });

        // Still the same page, and the list can still be changed
        expect(await pageTitle()).toEqual("Skipped folders");
        await deleteListItem("Templates");
        await browser.waitUntil(
            async () =>
                !((await getSetting("noteFoldersToIgnore")) as string[]).includes("Templates"),
            { timeoutMsg: "the folder was not removed" },
        );
        await browser.waitUntil(async () => !(await row("Templates").isExisting()), {
            timeoutMsg: "the removed folder is still in the list",
        });

        await addListItem("Add folder");
        const again = browser.$(".fs-text-prompt-input");
        await again.waitForClickable({ timeoutMsg: "the dialog did not open a second time" });
        await again.setValue("Archive");
        await clickWhenSettled(".modal-container button.mod-cta");
        await row("Archive").waitForDisplayed({
            timeoutMsg: "the second folder is not in the list",
        });
        expect(await pageTitle()).toEqual("Skipped folders");

        await goBack();
        expect(await entryValue("Skipped folders")).toEqual("2 folders");
    });
});
