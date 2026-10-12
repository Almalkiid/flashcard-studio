import { browser } from "@wdio/globals";
import * as fs from "fs";
import { describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

const pluginId = (
    JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as { id: string }
).id;

describe("welcome guide", function () {
    it("creates a sample deck whose cards can be reviewed", async function () {
        await browser.executeObsidianCommand(`${pluginId}:show-welcome`);
        // Text selectors can not be combined with a parent selector, so chain them
        const create = browser.$(".fs-welcome-modal").$("button=Create a sample deck");
        await create.waitForClickable({ timeoutMsg: "the welcome guide did not open" });
        await create.click();

        const samplePath = path.join(
            obsidianPage.getVaultPath(),
            "Flashcard Studio/Getting started.md",
        );
        // The file can appear on disk before its content is written, so wait for the content
        await browser.waitUntil(
            () =>
                fs.existsSync(samplePath) &&
                fs.readFileSync(samplePath, "utf8").includes("#flashcards/getting-started"),
            { timeoutMsg: "the sample deck was not created with its cards" },
        );

        // Its cards join the review once Obsidian has indexed the new note
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }) => {
                    const file = app.vault.getFileByPath("Flashcard Studio/Getting started.md");
                    return (app.metadataCache.getFileCache(file)?.tags ?? []).length > 0;
                }),
            { timeoutMsg: "the sample deck was never indexed" },
        );
        await browser.executeObsidianCommand(`${pluginId}:review-flashcards`);
        // The deck list can re-render while it loads, so retry the click until a card is shown
        const showAnswer = browser.$(".fs-view .fs-card-container .fs-show-answer-button");
        await browser.waitUntil(
            async () => {
                if (await showAnswer.isDisplayed()) return true;
                const deckRow = browser
                    .$(".fs-view .fs-deck-container")
                    .$(".fs-home-deck-name=Getting started");
                if (await deckRow.isClickable()) await deckRow.click();
                return false;
            },
            { timeoutMsg: "no sample card was shown after choosing the sample deck" },
        );
    });
});
