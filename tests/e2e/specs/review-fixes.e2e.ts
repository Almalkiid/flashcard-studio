import { browser, expect } from "@wdio/globals";
import { after, afterEach, beforeEach, describe, it } from "mocha";
import { obsidianPage } from "wdio-obsidian-service";

import {
    openReview,
    pluginId,
    readNote,
    setSettings,
    TAG,
    useNote,
    waitForPlugin,
} from "../card-syntax-helpers";

// The review screens' guards and announcements: one answer per card however often the button is pressed, a card
// that is not on screen cannot be acted on, the dialogs do what they say, and the screen reader is told what is up.
// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.

const CARD = ".fs-view .fs-card-container";

const TWO_CARDS = [
    TAG,
    "",
    "First question::First answer",
    "",
    "Second question::Second answer",
    "",
].join("\n");

const THREE_CARDS = [TAG, "", "One::1", "", "Two::2", "", "Three::3", ""].join("\n");

// The separator is a question mark, and so is the end of the question
const QUESTION_MARK_CARD = [TAG, "", "Is it?", "?", "Yes, it is.", ""].join("\n");

// A card answered Again waits a minute, then a card to skip
const WAITING_NOTE = [
    TAG,
    "",
    "What does CIA stand for?::Certified Internal Auditor",
    "",
    "What does CAE stand for?::Chief Audit Executive",
    "",
].join("\n");

/** Answered cards are buried for the day in the plugin's data, which resetting the vault leaves alone. */
async function clearBuryList(): Promise<void> {
    await browser.executeObsidian(async ({ app }, id) => {
        const plugin = (
            app as unknown as {
                plugins: {
                    plugins: Record<
                        string,
                        {
                            dataManager: {
                                data: { buryList: string[] };
                                settingsManager: { save: () => Promise<void> };
                            };
                        }
                    >;
                };
            }
        ).plugins.plugins[id];
        plugin.dataManager.data.buryList.length = 0;
        await plugin.dataManager.settingsManager.save();
    }, pluginId);
}

async function isMobile(): Promise<boolean> {
    return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

async function openFirstCard(): Promise<void> {
    await openReview();
    await browser
        .$(`${CARD} .fs-show-answer-button`)
        .waitForClickable({ timeoutMsg: "no card was shown" });
}

async function statusText(): Promise<string> {
    return String(await browser.$(`${CARD} .fs-live-region`).getProperty("textContent"));
}

/** How many answers the progress bar of the session shows. */
async function answersGiven(): Promise<number> {
    return browser.execute(
        () =>
            document.querySelectorAll(".fs-view .fs-session-progress-fill .fs-session-answer")
                .length,
    );
}

/** Opens the card menu and picks an item by its title (Obsidian's own menus, which the page can reach). */
async function pickFromCardMenu(title: string): Promise<void> {
    type VaultConfig = {
        getConfig(key: string): unknown;
        setConfig(key: string, value: unknown): void;
    };
    const nativeMenus = await browser.executeObsidian(({ app }) => {
        const vault = app.vault as unknown as VaultConfig;
        const before = vault.getConfig("nativeMenus");
        vault.setConfig("nativeMenus", false);
        return before;
    });
    try {
        await browser.$(`${CARD} .fs-extended-menu-button`).click();
        await browser.$(".menu").waitForDisplayed({ timeoutMsg: "the menu did not open" });
        await browser.pause(400);
        await browser.$(".menu").$(`div*=${title}`).click();
    } finally {
        await browser.executeObsidian(({ app }, value) => {
            (app.vault as unknown as VaultConfig).setConfig("nativeMenus", value);
        }, nativeMenus);
    }
}

describe("review screens: guards and announcements", function () {
    beforeEach(async function () {
        await browser.keys("Escape");
        await waitForPlugin();
        await clearBuryList();
        await setSettings({
            dailyLimitsEnabled: false,
            flashcardCardOrder: "NewFirstSequential",
            flashcardTags: [TAG],
            typeAnswers: false,
            reviewLook: "studio",
        });
    });

    after(async function () {
        await setSettings({ flashcardTags: ["#flashcards"], dailyLimitsEnabled: true });
        await obsidianPage.resetVault();
    });

    afterEach(async function () {
        await browser.keys("Escape");
        await setSettings({
            newCardsPerDay: 20,
            learnAheadMinutes: 20,
            showDeleteButtonInCardView: false,
        });
    });

    it("tells a screen reader which card is up, its side and the counts", async function () {
        await useNote(TWO_CARDS);
        await openFirstCard();
        expect(await statusText()).toMatch(
            /^Card 1 of 2, deck .+, front\. \d+ due, 2 new in the queue\.$/,
        );

        await browser.$(`${CARD} .fs-show-answer-button`).click();
        await browser.$(`${CARD} .fs-good-button`).waitForDisplayed();
        expect(await statusText()).toMatch(/^Answer shown\. Good: next in .+/);

        await browser.$(`${CARD} .fs-easy-button`).click();
        await browser.$(`${CARD} .fs-show-answer-button`).waitForClickable();
        expect(await statusText()).toMatch(/^Rated Easy, next in .+\. Undo available\.$/);
    });

    it("answers the card once however often the button is pressed", async function () {
        await useNote(TWO_CARDS);
        await openFirstCard();
        await browser.$(`${CARD} .fs-show-answer-button`).click();
        await browser.$(`${CARD} .fs-easy-button`).waitForClickable();

        // Two presses in the same moment, as a double tap makes
        await browser.execute(() => {
            const button = document.querySelector<HTMLElement>(".fs-view .fs-easy-button");
            button?.click();
            button?.click();
        });
        await browser.$(`${CARD} .fs-show-answer-button`).waitForClickable();
        await browser.pause(300);

        expect(await answersGiven()).toBe(1);
        // One schedule was written, not two on the same card
        expect((readNote().match(/<!--SR:/g) ?? []).length).toBe(1);
    });

    it("a held key reveals the answer and stops there", async function () {
        if (await isMobile()) this.skip();
        await useNote(TWO_CARDS);
        await openFirstCard();

        // The first press reveals; the repeats that follow while the key is held must not answer it
        await browser.execute(() => {
            for (let i = 0; i < 6; i++) {
                const target = document.activeElement ?? document.body;
                target.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: "Enter",
                        code: "Enter",
                        repeat: i > 0,
                        bubbles: true,
                        cancelable: true,
                    }),
                );
            }
        });
        await browser.$(`${CARD} .fs-good-button`).waitForDisplayed();
        await browser.pause(300);
        expect(await answersGiven()).toBe(0);
        expect(await browser.$(`${CARD} .fs-good-button`).isDisplayed()).toBe(true);
    });

    it("the waiting screen cannot be revealed or answered", async function () {
        if (await isMobile()) this.skip();
        await setSettings({ learnAheadMinutes: 0 });
        await useNote(WAITING_NOTE);
        await openFirstCard();
        await browser.$(`${CARD} .fs-show-answer-button`).click();
        await browser.$(`${CARD} .fs-again-button`).waitForClickable();
        // Again: the card is learning, due in a minute
        await browser.$(`${CARD} .fs-again-button`).click();
        await browser.$(`${CARD} .fs-show-answer-button`).waitForClickable();
        await browser.pause(400);
        await pickFromCardMenu("Skip");
        await browser
            .$(`${CARD} .fs-centered`)
            .waitForDisplayed({ timeoutMsg: "no waiting screen" });
        expect(await browser.$(`${CARD} .fs-centered`).getText()).toContain("Waiting");
        expect(await statusText()).toMatch(/^Waiting for the next card, about .+\.$/);

        for (const key of ["Enter", " "]) {
            await browser.keys(key);
            await browser.pause(300);
        }
        expect(await browser.$(`${CARD} .fs-centered`).isDisplayed()).toBe(true);
        expect(await browser.$(`${CARD} .fs-again-button`).isDisplayed()).toBe(false);
        expect(await browser.$(`${CARD} .fs-show-answer-button`).isDisplayed()).toBe(false);
        // The edit button of the toolbar has no card to edit, and does nothing
        await pickFromCardMenu("Edit this card");
        await browser.pause(400);
        expect(await browser.$$(".modal.fs-edit-modal").length).toBe(0);
    });

    it("the edit dialog keeps a card whose question ends in a question mark", async function () {
        await useNote(QUESTION_MARK_CARD);
        await openFirstCard();
        await pickFromCardMenu("Edit this card");
        await browser.$(".modal.fs-edit-modal").waitForDisplayed({ timeoutMsg: "no edit dialog" });

        const fields = await browser.$$(".modal.fs-edit-modal textarea.fs-input");
        expect(await fields[0].getValue()).toBe("Is it?");
        expect(await fields[1].getValue()).toBe("Yes, it is.");

        await browser.$(".modal.fs-edit-modal .fs-save-button").click();
        await browser.$(".modal.fs-edit-modal").waitForDisplayed({ reverse: true });
        await browser.pause(500);
        expect(readNote()).toContain("Is it?\n?\nYes, it is.");
    });

    it("the edit dialog keeps a card whose answer holds the separator", async function () {
        const original = "How is it written?::std::vector::push";
        await useNote([TAG, "", original, ""].join("\n"));
        await openFirstCard();
        await pickFromCardMenu("Edit this card");
        await browser.$(".modal.fs-edit-modal").waitForDisplayed({ timeoutMsg: "no edit dialog" });

        const fields = await browser.$$(".modal.fs-edit-modal textarea.fs-input");
        expect(await fields[0].getValue()).toBe("How is it written?");
        expect(await fields[1].getValue()).toBe("std::vector::push");

        await browser.$(".modal.fs-edit-modal .fs-save-button").click();
        await browser.$(".modal.fs-edit-modal").waitForDisplayed({ reverse: true });
        await browser.pause(500);
        expect(readNote()).toContain(original);
    });

    it("the Classic deck list opens a deck from the keyboard", async function () {
        if (await isMobile()) this.skip();
        await setSettings({ reviewLook: "classic" });
        await useNote(TWO_CARDS);
        await openFirstCard();
        await browser.$(`${CARD} .fs-back-button`).click();
        const row = browser.$(
            ".fs-view .fs-deck-container .fs-tree-container .fs-tree-item-row.is-clickable",
        );
        await row.waitForDisplayed({ timeoutMsg: "no deck list" });
        expect(await row.getAttribute("role")).toBe("button");
        expect(await row.getAttribute("tabindex")).toBe("0");

        await browser.execute(() => {
            document
                .querySelector<HTMLElement>(
                    ".fs-view .fs-deck-container .fs-tree-container .fs-tree-item-row.is-clickable",
                )
                ?.focus();
        });
        await browser.keys("Enter");
        await browser
            .$(`${CARD} .fs-show-answer-button`)
            .waitForClickable({ timeoutMsg: "Enter did not open the deck" });
    });

    it("the deck list says how many cards today's limit hides", async function () {
        if (await isMobile()) this.skip();
        await setSettings({ reviewLook: "classic", dailyLimitsEnabled: true, newCardsPerDay: 1 });
        await useNote(THREE_CARDS);
        await openFirstCard();
        await browser.$(`${CARD} .fs-back-button`).click();
        const note = browser.$(".fs-view .fs-deck-container .fs-tree-hidden-note");
        await note.waitForDisplayed({ timeoutMsg: "the deck list does not mention the limit" });
        expect(await note.getText()).toBe("2 hidden by today's limit");
    });

    it("deleting a card asks once, deletes once, and does not tell you 'Cancel'", async function () {
        await setSettings({ showDeleteButtonInCardView: true });
        await useNote(THREE_CARDS);
        await openFirstCard();
        await pickFromCardMenu("Remove this card");
        const confirm = browser.$(".fs-confirmation-modal-button-container button.mod-warning");
        await confirm.waitForDisplayed({ timeoutMsg: "no confirmation" });
        await browser.pause(300);

        // A double click on Confirm
        await browser.execute(() => {
            const button = document.querySelector<HTMLElement>(
                ".fs-confirmation-modal-button-container button.mod-warning",
            );
            button?.click();
            button?.click();
        });
        await browser
            .$(".fs-confirmation-modal-button-container")
            .waitForDisplayed({ reverse: true });
        await browser.pause(500);

        const left = readNote()
            .split("\n")
            .filter((line) => line.includes("::")).length;
        expect(left).toBe(2);
        const notices = await browser.execute(() =>
            Array.from(document.querySelectorAll(".notice")).map((n) => n.textContent ?? ""),
        );
        expect(notices.some((text) => text.trim() === "Cancel")).toBe(false);
    });
});
