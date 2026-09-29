import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { afterEach, before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.

// Read at runtime, never hard-code: the plugin id may change.
const manifest = JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as {
    id: string;
};
const pluginId = manifest.id;

const DECK_NOTE = "CIA/Part1/Deck.md";

// Obsidian's plugin registry is not part of the public typings.
interface AppWithPlugins {
    plugins: { plugins: Record<string, { isInitialized?: boolean } | undefined> };
}

/** Reads the note straight from the vault directory on disk, bypassing Obsidian's caches. */
function readNoteFromDisk(): string {
    return fs.readFileSync(path.join(obsidianPage.getVaultPath(), DECK_NOTE), "utf8");
}

describe("smoke", function () {
    before(async function () {
        // The plugin finishes initialising asynchronously, after the workspace layout is ready.
        // Its commands silently do nothing before that.
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
        // Restore the fixture notes (the plugin rewrites Deck.md when a card is reviewed).
        await obsidianPage.resetVault();
    });

    afterEach(async function () {
        // Close the review modal if a test left it open.
        await browser.keys("Escape");
    });

    it("loads the plugin in the expected platform mode", async function () {
        const loaded = await browser.executeObsidian(
            ({ app }, id) => (app as unknown as AppWithPlugins).plugins.plugins[id] !== undefined,
            pluginId,
        );
        expect(loaded).toEqual(true);

        // Guards against the mobile capability silently running as desktop (or vice versa).
        const requested = (
            browser.requestedCapabilities as Record<string, { emulateMobile?: boolean }>
        )["wdio:obsidianOptions"];
        const isMobile = await browser.executeObsidian(
            ({ obsidian }) => obsidian.Platform.isMobile,
        );
        expect(isMobile).toEqual(requested.emulateMobile === true);
    });

    it("reviews a card and writes its schedule to the note", async function () {
        expect(readNoteFromDisk()).not.toContain("<!--SR:");

        await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);

        // Review opens in a modal by default, or in a tab if openViewInNewTab is set. Both wrap
        // their content in `.sr-view`, so these selectors work for either.
        //
        // The fixture has a single deck (`#flashcards` in Deck.md), and ContentManager.open()
        // skips the deck list when only one deck has cards in the queue: it opens that deck's
        // first card directly. So there is no deck row to click here. A vault with several decks
        // shows the list first: `.sr-view .sr-deck-container:not(.sr-is-hidden)`, with one
        // clickable `.tag-pane-tag-self` row per deck.
        const showAnswer = browser.$(".sr-view .sr-card-container .sr-show-answer-button");
        await showAnswer.waitForClickable({ timeoutMsg: "card front / Show Answer not shown" });
        await showAnswer.click();

        const good = browser.$(".sr-view .sr-card-container .sr-good-button");
        await good.waitForClickable({ timeoutMsg: "Good button not shown after Show Answer" });
        await good.click();

        await browser.waitUntil(() => readNoteFromDisk().includes("<!--SR:"), {
            timeoutMsg: `${DECK_NOTE} on disk never got a <!--SR: schedule comment`,
        });
        // Exactly one question was rescheduled.
        expect(readNoteFromDisk().split("<!--SR:").length - 1).toEqual(1);
    });
});
