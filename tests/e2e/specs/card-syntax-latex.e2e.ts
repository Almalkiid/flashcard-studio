import { browser, expect } from "@wdio/globals";
import { after, afterEach, before, describe, it } from "mocha";
import { obsidianPage } from "wdio-obsidian-service";

import {
    answerEasy,
    openReview,
    pluginId,
    readNote,
    SCHEDULE,
    setSettings,
    TAG,
    useNote,
    waitForPlugin,
} from "../card-syntax-helpers";

// M3b: clozes in LaTeX math, \cloze{answer}{hint}.
// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.
//
// This is its own spec file on purpose. Each spec file gets a fresh Obsidian, and the first test disables and
// enables the plugin: that only works before obsidianPage.resetVault() has been called in the session, because
// resetVault also removes the plugin's files from the vault, so the plugin could not be enabled again.

async function renders(source: string): Promise<boolean> {
    return browser.executeObsidian(async ({ obsidian }, math) => {
        await obsidian.loadMathJax();
        const element = obsidian.renderMath(math, false);
        await obsidian.finishRenderMath();
        return !element.querySelector("mjx-merror") && !element.innerHTML.includes("color: red");
    }, source);
}

// The settings are read through the plugin's own settings tab element: on desktop Obsidian may show the settings
// window in a window of its own, which is not part of the main document.
interface AppWithSettings {
    setting: {
        open(): void;
        close(): void;
        openTabById(id: string): void;
        activeTab: { containerEl: HTMLElement };
    };
}

async function openPluginSettings(): Promise<void> {
    await browser.executeObsidian(({ app }, id) => {
        const setting = (app as unknown as AppWithSettings).setting;
        setting.open();
        setting.openTabById(id);
    }, pluginId);
}

async function closeSettings(): Promise<void> {
    await browser.executeObsidian(({ app }) => (app as unknown as AppWithSettings).setting.close());
}

async function settingNames(): Promise<string[]> {
    return browser.executeObsidian(({ app }) =>
        Array.from(
            (app as unknown as AppWithSettings).setting.activeTab.containerEl.querySelectorAll(
                ".setting-item-name",
            ),
        ).map((element) => element.textContent ?? ""),
    );
}

/** Clicks the toggle of the plugin setting with this name. */
async function clickToggle(name: string): Promise<void> {
    await browser.executeObsidian(({ app }, label) => {
        const item = Array.from(
            (app as unknown as AppWithSettings).setting.activeTab.containerEl.querySelectorAll(
                ".setting-item",
            ),
        ).find((element) => element.querySelector(".setting-item-name")?.textContent === label);
        (item?.querySelector(".checkbox-container") as HTMLElement).click();
    }, name);
}

async function readSetting(key: string): Promise<unknown> {
    return browser.executeObsidian(
        ({ app }, id, settingKey) =>
            (
                app as unknown as {
                    plugins: {
                        plugins: Record<
                            string,
                            { dataManager: { data: { settings: Record<string, unknown> } } }
                        >;
                    };
                }
            ).plugins.plugins[id].dataManager.data.settings[settingKey],
        pluginId,
        key,
    );
}

describe("card syntax: clozes in LaTeX math", function () {
    before(waitForPlugin);

    afterEach(async function () {
        await browser.keys("Escape");
    });

    after(async function () {
        await setSettings({
            latexClozes: false,
            atomicClozes: false,
            flashcardTags: ["#flashcards"],
        });
        await obsidianPage.resetVault();
    });

    it("defines \\cloze for MathJax while the setting is on, and removes it when the plugin unloads", async function () {
        await setSettings({ latexClozes: false });
        await obsidianPage.disablePlugin(pluginId);
        await obsidianPage.enablePlugin(pluginId);
        await waitForPlugin();
        expect(await renders("\\cloze{x^2}{hint}")).toBe(false);

        await setSettings({ latexClozes: true });
        await obsidianPage.disablePlugin(pluginId);
        await obsidianPage.enablePlugin(pluginId);
        await waitForPlugin();
        await browser.waitUntil(() => renders("\\cloze{x^2}{hint}"), {
            timeoutMsg: "\\cloze was not defined for MathJax with the setting on",
        });

        // Nested LaTeX renders as well
        expect(await renders("\\cloze{\\frac{a}{b}}{}")).toBe(true);

        await obsidianPage.disablePlugin(pluginId);
        expect(await renders("\\cloze{x^2}{hint}")).toBe(false);

        await obsidianPage.enablePlugin(pluginId);
        await waitForPlugin();
        await browser.waitUntil(() => renders("\\cloze{x^2}{hint}"), {
            timeoutMsg: "\\cloze was not defined again after the plugin was enabled",
        });
    });

    it("the settings page has the card syntax settings, and the LaTeX toggle defines and removes the macro", async function () {
        // (The previous test left the setting on, and the macro defined)
        expect(await readSetting("latexClozes")).toBe(true);
        expect(await renders("\\cloze{x}{y}")).toBe(true);

        await openPluginSettings();
        for (const name of [
            "Callout card types",
            "Characters denoting the start of clozes and multiline flashcards",
            "Cloze card is only the line with the cloze",
            "Clozes in LaTeX math",
        ]) {
            await browser.waitUntil(async () => (await settingNames()).includes(name), {
                timeoutMsg: `the settings page never showed "${name}"`,
            });
        }

        // Turning the toggle off removes the macro, turning it on defines it again
        await clickToggle("Clozes in LaTeX math");
        await browser.waitUntil(async () => !(await renders("\\cloze{x}{y}")), {
            timeoutMsg: "\\cloze was still defined after the toggle was turned off",
        });
        expect(await readSetting("latexClozes")).toBe(false);
        await clickToggle("Clozes in LaTeX math");
        await browser.waitUntil(() => renders("\\cloze{x}{y}"), {
            timeoutMsg: "\\cloze was not defined after the toggle was turned on",
        });
        expect(await readSetting("latexClozes")).toBe(true);

        await clickToggle("Cloze card is only the line with the cloze");
        await browser.waitUntil(async () => (await readSetting("atomicClozes")) === true, {
            timeoutMsg: "the atomic clozes toggle did not change the setting",
        });

        await closeSettings();
    });

    it("reviews a math cloze: the answer is hidden on the front and shown on the back", async function () {
        await setSettings({
            latexClozes: true,
            atomicClozes: false,
            dailyLimitsEnabled: false,
            flashcardTags: [TAG],
        });
        await useNote(`${TAG}\n\n$$\n\\cloze{c^2}{} = a^2 + b^2\n$$\n`);

        await openReview();
        const button = browser.$(".sr-view .sr-card-container .sr-show-answer-button");
        await button.waitForClickable({ timeoutMsg: "the math cloze card was not shown" });

        const frontState = () =>
            browser.execute(() => {
                const content = document.querySelector(".sr-view .sr-card-container .sr-content");
                return {
                    math: content?.querySelectorAll("mjx-container").length ?? 0,
                    error: content?.querySelector("mjx-merror") !== null,
                    raw: content?.textContent?.includes("\\cloze") ?? true,
                    html: content?.innerHTML.slice(0, 400) ?? "no content",
                };
            });
        // The card content is rendered after the button appears
        await browser.waitUntil(async () => (await frontState()).math > 0, {
            timeoutMsg: `the math of the card front was never rendered: ${JSON.stringify(await frontState())}`,
        });
        const front = await frontState();
        expect(front.error).toBe(false);
        expect(front.raw).toBe(false);

        await button.click();
        await browser.$(".sr-view .sr-card-container .sr-easy-button").waitForClickable();
        await answerEasy();

        await browser.waitUntil(() => readNote().includes("<!--SR:"), {
            timeoutMsg: "no schedule was written",
        });
        // The formula in the note is untouched, and the schedule is after the closing $$
        expect(readNote()).toMatch(
            new RegExp(
                `\\n\\$\\$\\n\\\\cloze\\{c\\^2\\}\\{\\} = a\\^2 \\+ b\\^2\\n\\$\\$\\n${SCHEDULE}\\n$`,
            ),
        );
    });
});
