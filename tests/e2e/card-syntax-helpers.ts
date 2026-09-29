import { browser } from "@wdio/globals";
import * as fs from "fs";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

// Helpers shared by the card syntax specs (card-syntax.e2e.ts and card-syntax-latex.e2e.ts).

const manifest = JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as {
    id: string;
};
export const pluginId = manifest.id;

// The specs use their own deck tag, so that the fixture deck (#flashcards) is not part of their reviews
export const NOTE = "Syntax deck.md";
export const TAG = "#syntax";

/** One scheduling comment. */
export const SCHEDULE = "<!--SR:![^>]*-->";

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

export function readNote(): string {
    return fs.readFileSync(path.join(obsidianPage.getVaultPath(), NOTE), "utf8");
}

export async function waitForPlugin(): Promise<void> {
    await browser.waitUntil(
        () =>
            browser.executeObsidian(({ app }, id) => {
                const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
                return plugin !== undefined && plugin.isInitialized === true;
            }, pluginId),
        { timeoutMsg: `plugin ${pluginId} did not finish initialising` },
    );
}

export async function setSettings(settings: Record<string, unknown>): Promise<void> {
    await browser.executeObsidian(
        async ({ app }, id, values) => {
            const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
            if (plugin === undefined) throw new Error(`plugin ${id} is not loaded`);
            Object.assign(plugin.dataManager.data.settings, values);
            await plugin.dataManager.settingsManager.save();
        },
        pluginId,
        settings,
    );
}

/** Restores the fixture vault, adds this note to it, and waits until Obsidian has indexed the note's tag. */
export async function useNote(text: string): Promise<void> {
    await obsidianPage.resetVault();
    await obsidianPage.write(NOTE, text);
    await browser.waitUntil(
        () =>
            browser.executeObsidian(
                ({ app }, notePath, tag) => {
                    const file = app.vault.getFileByPath(notePath);
                    const tags = file ? app.metadataCache.getFileCache(file)?.tags : undefined;
                    return (tags ?? []).some((cached) => cached.tag === tag);
                },
                NOTE,
                TAG,
            ),
        { timeoutMsg: `Obsidian never indexed the ${TAG} tag of the note` },
    );
}

/** The rendered card, without the note-title context line that every card shares. */
export async function cardText(): Promise<string> {
    return browser.execute(() => {
        const content = document.querySelector(".sr-view .sr-card-container .sr-content");
        if (!content) return "";
        const clone = content.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".sr-context").forEach((element) => element.remove());
        return clone.innerText.trim();
    });
}

/** Shows the answer of the card that is up. Returns the text of the front, and of the front with the back. */
export async function showAnswer(): Promise<{ front: string; withBack: string }> {
    const button = browser.$(".sr-view .sr-card-container .sr-show-answer-button");
    await button.waitForClickable({ timeoutMsg: "card front / Show Answer not shown" });
    const front = await cardText();
    await button.click();
    await browser.$(".sr-view .sr-card-container .sr-easy-button").waitForClickable({
        timeoutMsg: "the answer buttons were not shown",
    });
    return { front, withBack: await cardText() };
}

// Easy, not Good: a new card answered Good is due again within minutes (a learning step), Easy graduates it to days
export async function answerEasy(): Promise<void> {
    await browser.$(".sr-view .sr-card-container .sr-easy-button").click();
}

export async function openReview(): Promise<void> {
    await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
}
