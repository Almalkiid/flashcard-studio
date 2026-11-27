import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { after, afterEach, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

import {
    answerEasy,
    openReview,
    pluginId,
    readNote,
    setSettings,
    showAnswer,
    TAG,
    useNote,
} from "../card-syntax-helpers";

// A card number no mask or cloze uses any more keeps its history in the note, as Anki keeps the card until "Empty
// Cards"; "Remove history of removed cards" lists and removes it. Runs once per capability in wdio.conf.mts: desktop,
// and emulated mobile. Set SCREENSHOTS=1 to also save screenshots to docs/media/screenshots.

const SCREENSHOT_DIR = path.resolve("docs/media/screenshots");
const takeScreenshots = process.env.SCREENSHOTS === "1";

// Card 1 is due; card 2's mask was deleted, so only its history is left
const CARD_1 = "2026-01-01,3,250,c=1,id=aaaaaa";
const KEPT_2 = "2026-01-02,7,230,c=2,id=bbbbbb";
const RIGHT_ATRIUM = "rect 0.1440 0.2891 0.2520 0.0984";

const NOTE_TEXT = [
    TAG,
    "",
    "Blood comes back into the ==1;;right atrium==.",
    "```image-cloze",
    "image: [[Heart.png]]",
    "mode: hide-all",
    `mask: 1 | ra ${RIGHT_ATRIUM} |`,
    "```",
    `<!--SR:!${CARD_1}!${KEPT_2}-->`,
    "",
].join("\n");

const DIALOG = ".modal.fs-kept-history-modal";
const ROW = `${DIALOG} .fs-suspended-row`;

async function screenshot(name: string): Promise<void> {
    if (!takeScreenshots) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await browser.execute(() => {
        for (const notice of Array.from(document.querySelectorAll(".notice"))) notice.detach();
    });
    const mobile = await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
    await browser.saveScreenshot(
        path.join(SCREENSHOT_DIR, `kept-history-${name}-${mobile ? "mobile" : "desktop"}.png`),
    );
}

/**
 * Waits until a dialog has stopped moving: on a phone it slides up from the bottom, and a tap or a screenshot taken while
 * it moves finds its buttons still below the screen (as in occlusion.e2e.ts).
 */
async function waitUntilStill(selector: string): Promise<void> {
    const topOf = () =>
        browser.execute(
            (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? 0,
            selector,
        );
    let top = await topOf();
    for (let tries = 0; tries < 30; tries++) {
        await browser.pause(100);
        const later = await topOf();
        const moved = Math.abs(later - top);
        top = later;
        if (moved < 0.5) return;
    }
}

async function openDialog(): Promise<void> {
    await browser.executeObsidianCommand(`${pluginId}:remove-kept-history`);
    await browser.$(DIALOG).waitForDisplayed({ timeoutMsg: "no History of removed cards dialog" });
    await waitUntilStill(DIALOG);
}

describe("History of removed cards", function () {
    beforeEach(async function () {
        await useNote(NOTE_TEXT);
        await setSettings({ flashcardTags: [TAG], dailyLimitsEnabled: false });
    });

    after(async function () {
        await setSettings({ flashcardTags: ["#flashcards"], dailyLimitsEnabled: true });
        await obsidianPage.resetVault();
    });

    afterEach(async function () {
        if (await browser.$(DIALOG).isExisting()) await browser.keys("Escape");
        await browser
            .$(DIALOG)
            .waitForExist({ reverse: true, timeoutMsg: "the dialog did not close" });
    });

    it("a review of the card that is left keeps the removed card's history, as it was", async function () {
        await openReview();
        await showAnswer();
        await answerEasy();
        await browser.waitUntil(() => !readNote().includes(CARD_1), {
            timeoutMsg: "the review was not saved",
        });
        // Card 1's segment is rewritten (in the vault's own format); card 2's is kept as it was, after it
        expect(readNote()).toMatch(/,c=1,id=aaaaaa!2026-01-02,7,230,c=2,id=bbbbbb-->\n$/);
        // The review is closed before the next test opens the list
        await browser.keys("Escape");
        await browser.$(".fs-view").waitForExist({
            reverse: true,
            timeoutMsg: "the review did not close",
        });
    });

    it("lists the removed card with its note, and removes its history only after asking", async function () {
        await openDialog();
        await browser.waitUntil(async () => (await browser.$$(ROW).length) === 1, {
            timeoutMsg: "the removed card was not listed",
        });
        const row = await browser.$(ROW).getText();
        // The question as plain words: no cloze marks, no HTML
        expect(row).toContain("Card 2 of “Blood comes back into the right atrium.”");
        expect(row).toContain("Syntax deck.md");
        await screenshot("list");

        await browser.$(`${ROW} .fs-kept-history-remove`).click();
        const confirm = browser.$(
            ".modal .fs-confirmation-modal-button-container button.mod-warning",
        );
        await confirm.waitForExist({ timeoutMsg: "Remove did not ask first" });
        await waitUntilStill(".modal:has(.fs-confirmation-modal-button-container)");
        await confirm.waitForClickable({ timeoutMsg: "the confirmation cannot be pressed" });
        await screenshot("confirm");
        // Nothing changes before the confirmation
        expect(readNote()).toContain(KEPT_2);
        await confirm.click();

        await browser.waitUntil(() => !readNote().includes("c=2"), {
            timeoutMsg: "the history was not removed",
        });
        expect(readNote()).toBe(NOTE_TEXT.replace(`!${KEPT_2}`, ""));
        await browser
            .$(`${DIALOG} .fs-suspended-empty`)
            .waitForDisplayed({ timeoutMsg: "the list did not empty" });
    });
});
