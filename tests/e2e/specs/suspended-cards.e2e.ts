import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { after, afterEach, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

import {
    NOTE,
    openReview,
    pluginId,
    readNote,
    setSettings,
    showAnswer,
    TAG,
    useNote,
    waitForPlugin,
} from "../card-syntax-helpers";

// Issue #26: a card suspended by accident can be found again. The "Show suspended cards" dialog lists every suspended
// card of the vault, filters them by text and deck, and puts them back one by one or all at once after a confirmation.
// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.

const OTHER = "Other deck.md";
const OTHER_TAG = "#syntax/other";
// 2000-01-01 is the placeholder of a card never reviewed; Alpha has been reviewed, so it keeps its schedule
const SUSPENDED = (id: string) => `<!--SR:!2000-01-01,1,250,id=${id},susp-->`;
const REVIEWED_SUSPENDED = "<!--SR:!2026-12-01,3,250,id=aaaaaa,susp-->";

const MAIN_NOTE = [
    TAG,
    "",
    `Alpha question::Alpha answer ${REVIEWED_SUSPENDED}`,
    "",
    "Active question::Active answer",
    "",
].join("\n");

const OTHER_NOTE = [
    OTHER_TAG,
    "",
    `Beta question::Beta answer ${SUSPENDED("bbbbbb")}`,
    "",
    `Gamma question::Gamma answer ${SUSPENDED("cccccc")}`,
    "",
].join("\n");

const DIALOG = ".modal.fs-suspended-modal";
const ROW = `${DIALOG} .fs-suspended-row`;

function readOther(): string {
    return fs.readFileSync(path.join(obsidianPage.getVaultPath(), OTHER), "utf8");
}

async function useNotes(): Promise<void> {
    await useNote(MAIN_NOTE);
    await obsidianPage.write(OTHER, OTHER_NOTE);
    await browser.waitUntil(
        () =>
            browser.executeObsidian(
                ({ app }, notePath, tag) => {
                    const file = app.vault.getFileByPath(notePath);
                    const tags = file ? app.metadataCache.getFileCache(file)?.tags : undefined;
                    return (tags ?? []).some((cached) => cached.tag === tag);
                },
                OTHER,
                OTHER_TAG,
            ),
        { timeoutMsg: "Obsidian never indexed the tag of the second note" },
    );
    await waitForPlugin();
}

async function openDialog(): Promise<void> {
    await browser.executeObsidianCommand(`${pluginId}:show-suspended-cards`);
    await browser.$(DIALOG).waitForDisplayed({ timeoutMsg: "no Suspended cards dialog" });
}

async function rowTexts(): Promise<string[]> {
    const rows = await browser.$$(ROW);
    const texts: string[] = [];
    for (const row of rows) texts.push(await row.getText());
    return texts;
}

async function search(text: string): Promise<void> {
    // As typing does: set the text and send the input event (WebdriverIO's clearing sends none)
    await browser.execute(
        (selector, value) => {
            const box = document.querySelector<HTMLInputElement>(selector);
            if (!box) throw new Error("no search box");
            box.value = value;
            box.dispatchEvent(new Event("input", { bubbles: true }));
        },
        `${DIALOG} input.fs-suspended-search`,
        text,
    );
}

/** The markdown tabs and the note each shows. */
async function openNotes(): Promise<string[]> {
    return browser.executeObsidian(({ app }) => {
        const paths: string[] = [];
        app.workspace.iterateAllLeaves((leaf) => {
            const file = (leaf.view as { file?: { path: string } }).file;
            if (leaf.view.getViewType() === "markdown" && file) paths.push(file.path);
        });
        return paths;
    });
}

describe("Suspended cards (#26)", function () {
    beforeEach(async function () {
        await useNotes();
        // Only the notes under the deck tag have cards; the fixture vault's tag is #flashcards
        await setSettings({ flashcardTags: [TAG], dailyLimitsEnabled: false });
    });

    after(async function () {
        await setSettings({ flashcardTags: ["#flashcards"], dailyLimitsEnabled: true });
        await obsidianPage.resetVault();
    });

    afterEach(async function () {
        // A dialog left open would cover the next test
        if (await browser.$(DIALOG).isExisting()) await browser.keys("Escape");
        await browser
            .$(DIALOG)
            .waitForExist({ reverse: true, timeoutMsg: "the dialog did not close" });
    });

    it("lists every suspended card of the vault, and only those", async function () {
        await openDialog();
        const texts = await rowTexts();
        expect(texts.length).toBe(3);
        expect(texts.join("\n")).toContain("Alpha question");
        expect(texts.join("\n")).toContain("Beta question");
        expect(texts.join("\n")).toContain("Gamma question");
        expect(texts.join("\n")).not.toContain("Active question");
        expect(await browser.$(`${DIALOG} .fs-suspended-count`).getText()).toContain("3");
    });

    it("filters by text and by deck", async function () {
        await openDialog();
        await search("ALPHA");
        expect(await rowTexts()).toHaveLength(1);
        await search("");
        expect(await rowTexts()).toHaveLength(3);
        const options = await browser.execute(
            (selector) =>
                [...document.querySelectorAll<HTMLOptionElement>(`${selector} option`)].map(
                    (option) => option.value,
                ),
            `${DIALOG} select.fs-suspended-deck`,
        );
        expect(options).toContain("syntax/other");
        await browser
            .$(`${DIALOG} select.fs-suspended-deck`)
            .selectByAttribute("value", "syntax/other");
        const texts = await rowTexts();
        expect(texts).toHaveLength(2);
        expect(texts.join("\n")).not.toContain("Alpha question");
    });

    it("unsuspends one card in its note, and no other", async function () {
        await openDialog();
        await search("alpha");
        await browser.$(`${ROW} .fs-suspended-unsuspend`).click();
        await browser.waitUntil(() => !readNote().includes("susp"), {
            timeoutMsg: "the card was not unsuspended in its note",
        });
        // Only the flag goes: every other byte of the note stays as it was
        expect(readNote()).toBe(MAIN_NOTE.replace(",susp-->", "-->"));
        expect(readOther().match(/,susp/g)).toHaveLength(2);
        await search("");
        expect(await rowTexts()).toHaveLength(2);
    });

    it("unsuspends all the cards shown, after asking, and leaves the hidden ones alone", async function () {
        await openDialog();
        await search("beta");
        await browser.$(`${DIALOG} .fs-suspended-all`).click();
        // Nothing changes before the confirmation
        const confirm = browser.$(
            ".modal .fs-confirmation-modal-button-container button.mod-warning",
        );
        await confirm.waitForClickable({ timeoutMsg: "Unsuspend all did not ask first" });
        expect(readOther().match(/,susp/g)).toHaveLength(2);
        await confirm.click();
        await browser.waitUntil(() => (readOther().match(/,susp/g) ?? []).length === 1, {
            timeoutMsg: "the shown card was not unsuspended",
        });
        expect(readOther()).toContain("Gamma question::Gamma answer " + SUSPENDED("cccccc"));
        expect(readNote()).toContain(REVIEWED_SUSPENDED);
    });

    it("opens the note of a card", async function () {
        await openDialog();
        await search("gamma");
        await browser.$(`${ROW} .fs-suspended-open`).click();
        await browser
            .$(DIALOG)
            .waitForDisplayed({ reverse: true, timeoutMsg: "the dialog stayed open" });
        await browser.waitUntil(async () => (await openNotes()).includes(OTHER), {
            timeoutMsg: "the note was not opened",
        });
    });

    it("the review screen still opens the note of the card on screen", async function () {
        await openReview();
        await showAnswer();
        // The answer commands exist only with custom hotkeys on, so the action behind them is called directly
        await browser.executeObsidian(async ({ app }, id) => {
            const plugin = (
                app as unknown as {
                    plugins: {
                        plugins: Record<
                            string,
                            {
                                uiManager: {
                                    contentManager: { _jumpToCurrentCard: () => Promise<void> };
                                };
                            }
                        >;
                    };
                }
            ).plugins.plugins[id];
            await plugin.uiManager.contentManager._jumpToCurrentCard();
        }, pluginId);
        await browser.waitUntil(async () => (await openNotes()).includes(NOTE), {
            timeoutMsg: "the review screen did not open the note",
        });
    });
});
