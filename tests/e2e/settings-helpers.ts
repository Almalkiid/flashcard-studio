import { browser } from "@wdio/globals";
import * as fs from "fs";
import * as path from "path";

// Helpers shared by the specs that drive the plugin's settings (settings, scheduling and ai-generate).
//
// The settings are Obsidian's own declarative settings, so a row is a `.setting-item` with its label in
// `.setting-item-name`, a page entry is a row with `mod-navigable`, and a page has a `.setting-page-back-button`.
// Rows are found by the name they show. Rows that a `visible` rule hides stay in the page but are not displayed, so
// check `isDisplayed()` rather than existence.

const manifest = JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as {
    id: string;
};
export const pluginId = manifest.id;

interface AppWithSetting {
    setting: { open: () => void; close: () => void; openTabById: (id: string) => void };
}
interface PluginWithData {
    dataManager: { data: { settings: Record<string, unknown> } };
}
interface AppWithPlugins {
    plugins: { plugins: Record<string, PluginWithData | undefined> };
}

/** The window that holds the notes and the review. On desktop the settings open in a second window. */
let mainWindow = "";

/**
 * Runs `fn` in the window that holds the notes. `browser.executeObsidian` only works there, and on desktop the
 * settings are in a window of their own.
 */
export async function inMainWindow<T>(fn: () => Promise<T>): Promise<T> {
    const current = await browser.getWindowHandle();
    const switching = mainWindow !== "" && current !== mainWindow;
    if (switching) await browser.switchToWindow(mainWindow);
    try {
        return await fn();
    } finally {
        if (switching) await browser.switchToWindow(current);
    }
}

/** Whether this run is the emulated phone. */
export async function isMobile(): Promise<boolean> {
    return inMainWindow(() =>
        browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile),
    );
}

/** A stored setting, read from the plugin's data. */
export async function getSetting(key: string): Promise<unknown> {
    return inMainWindow(() =>
        browser.executeObsidian(
            ({ app }, id, settingKey) => {
                const plugin = (app as unknown as AppWithPlugins).plugins.plugins[
                    id
                ] as PluginWithData;
                return plugin.dataManager.data.settings[settingKey];
            },
            pluginId,
            key,
        ),
    );
}

/**
 * Opens Obsidian's settings, on the plugin's first page unless `pluginTab` is false (then on Obsidian's own list, with
 * the search box). Desktop Obsidian opens the settings in a second window, which the driver switches to; the emulated
 * phone slides them up as a sheet in the same window.
 */
export async function openSettings(pluginTab = true): Promise<void> {
    mainWindow = await browser.getWindowHandle();
    const before = await browser.getWindowHandles();
    const mobile = await isMobile();
    // The phone puts the sheet back on the page it was closed on. Choosing the plugin's tab in the same breath as
    // opening the sheet then leaves the tab empty, so on the phone the tab is chosen once the sheet has settled.
    await browser.executeObsidian(
        ({ app }, id, openPluginTab) => {
            const setting = (app as unknown as AppWithSetting).setting;
            setting.open();
            if (openPluginTab) setting.openTabById(id);
        },
        pluginId,
        pluginTab && !mobile,
    );

    if (mobile) {
        if (pluginTab) {
            await browser
                .$(".modal.mod-settings")
                .waitForStable({ timeoutMsg: "the settings sheet kept moving" });
            await browser.executeObsidian(({ app }, id) => {
                (app as unknown as AppWithSetting).setting.openTabById(id);
            }, pluginId);
        }
    } else {
        await browser.waitUntil(
            async () => (await browser.getWindowHandles()).length > before.length,
            { timeoutMsg: "the settings window did not open" },
        );
        const settingsWindow = (await browser.getWindowHandles()).find(
            (handle) => !before.includes(handle),
        );
        await browser.switchToWindow(settingsWindow ?? "");
    }
    const search = browser.$(".setting-search-container input");
    const ready = pluginTab ? row("Flashcard tags") : search;
    if (!pluginTab && mobile) {
        // The phone opens on the page it was left on, so step back out of it to the list that has the search box
        const back = browser.$(".modal-setting-back-button");
        await browser.waitUntil(
            async () => (await search.isDisplayed()) || (await back.isDisplayed()),
            { timeoutMsg: "the settings did not open" },
        );
        if (!(await search.isDisplayed())) {
            await back.waitForStable({ timeoutMsg: "the settings kept moving" });
            await back.click();
        }
    }
    await ready.waitForDisplayed({ timeoutMsg: "the settings did not open" });
    // The sheet slides up on the phone, and a click during the slide misses
    await ready.waitForStable({ timeoutMsg: "the settings kept moving" });
}

/** Closes the settings, and on desktop their window, and goes back to the window that holds the notes. */
export async function closeSettings(): Promise<void> {
    if (mainWindow === "") return;
    await browser.switchToWindow(mainWindow);
    await browser.executeObsidian(({ app }) => (app as unknown as AppWithSetting).setting.close());
    // Only the main window is left once the settings window is gone
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1, {
        timeoutMsg: "the settings window did not close",
    });
}

/**
 * The row with this name. Some names are on two rows ("Tags to skip" is in Cards and in Note review), so
 * `occurrence` counts from 1 in the order they appear.
 */
export function row(name: string, occurrence = 1): ChainablePromiseElement {
    const byName = `//div[contains(concat(' ', normalize-space(@class), ' '), ' setting-item ')][./div[contains(@class, 'setting-item-info')]/div[contains(@class, 'setting-item-name')][normalize-space()="${name}"]]`;
    return browser.$(`(${byName})[${occurrence}]`);
}

/** Whether the row has this class, such as `is-disabled` or `is-invalid`. */
export async function rowHasClass(
    name: string,
    className: string,
    occurrence = 1,
): Promise<boolean> {
    return ((await row(name, occurrence).getAttribute("class")) ?? "")
        .split(/\s+/)
        .includes(className);
}

/** What the row shows on its right for a page entry, such as "1 folder". */
export async function entryValue(name: string): Promise<string> {
    return row(name).$(".setting-item-value").getText();
}

/** The error text under a row's field, or an empty string while the value is fine. */
export async function rowError(name: string, occurrence = 1): Promise<string> {
    const error = row(name, occurrence).$(".setting-item-error");
    if (!(await error.isExisting()) || !(await error.isDisplayed())) return "";
    return error.getText();
}

/** The title of the page that is open, or an empty string on the plugin's first page. */
export async function pageTitle(): Promise<string> {
    const title = browser.$(".setting-page-title");
    // The phone shows the title in the sheet's own header and hides this one, so read the text, not what is visible
    return (await title.isExisting()) ? ((await title.getProperty("textContent")) as string) : "";
}

/** Opens a page entry, such as "Advanced FSRS", and waits for that page to open. */
export async function openPage(name: string): Promise<void> {
    const entry = row(name);
    await entry.waitForClickable({ timeoutMsg: `the ${name} entry is not shown` });
    await entry.waitForStable({ timeoutMsg: `the ${name} entry kept moving` });
    await entry.click();
    await browser.waitUntil(async () => (await pageTitle()) === name, {
        timeoutMsg: `the ${name} page did not open`,
    });
}

/** Goes back from a page to the plugin's first page. */
export async function goBack(): Promise<void> {
    // Desktop has the back button in the page, the phone in the header of the sheet
    const back = browser.$(
        (await isMobile()) ? ".modal-setting-back-button" : ".setting-page-back-button",
    );
    await back.waitForClickable({ timeoutMsg: "the back button is not shown" });
    await back.click();
    await browser.waitUntil(async () => (await pageTitle()) === "", {
        timeoutMsg: "the page did not close",
    });
}

/** Presses the add button of a list page: a button in the list's heading on desktop, a row on the phone. */
export async function addListItem(label: string): Promise<void> {
    const button = browser.$(`.setting-page .extra-setting-button[aria-label="${label}"]`);
    const target = (await button.isDisplayed()) ? button : row(label);
    await target.waitForClickable({ timeoutMsg: `${label} is not shown` });
    await target.click();
}

/** Removes the entry of a list page that has this text. */
export async function deleteListItem(text: string): Promise<void> {
    const button = row(text).$('.extra-setting-button[aria-label="Delete"]');
    await button.waitForClickable({ timeoutMsg: `the entry ${text} has no delete button` });
    await button.click();
}

/** Types into a row's field and leaves it. A valid value is saved, and an invalid one shows the row's error. */
export async function typeInto(
    name: string,
    value: string,
    control: "input" | "textarea" = "input",
    occurrence = 1,
): Promise<void> {
    const field = row(name, occurrence).$(control);
    await field.waitForClickable({ timeoutMsg: `the ${name} field is not shown` });
    // Select what is there and type over it, as a person does. WebDriver's own clear leaves the field, and a number
    // field that is left empty puts its default back, so the digits typed next would join the default.
    await field.click();
    await browser.execute(
        (element) => (element as HTMLInputElement).select(),
        await field.getElement(),
    );
    if (value === "") await browser.keys("Backspace");
    else await field.addValue(value);
    // A number is saved when the field is left, a text as it is typed. A phone has no Tab key, so blur as tapping away
    // does.
    await browser.execute(() => (document.activeElement as HTMLElement).blur());
}

/** Clicks the switch of a toggle row. */
export async function clickToggle(name: string): Promise<void> {
    const toggle = row(name).$(".checkbox-container");
    await toggle.waitForClickable({ timeoutMsg: `the ${name} switch is not shown` });
    await toggle.click();
}

/** Whether a toggle row is on. */
export async function isToggleOn(name: string): Promise<boolean> {
    return ((await row(name).$(".checkbox-container").getAttribute("class")) ?? "")
        .split(/\s+/)
        .includes("is-enabled");
}

/**
 * Clicks a button in a dialog once it has stopped moving: the emulated phone slides dialogs up as a drawer, and a
 * click during the slide misses the button.
 */
export async function clickWhenSettled(selector: string): Promise<void> {
    const element = browser.$(selector);
    await element.waitForClickable({ timeoutMsg: `${selector} is not clickable` });
    await element.waitForStable({ timeoutMsg: `${selector} kept moving` });
    await element.click();
}
