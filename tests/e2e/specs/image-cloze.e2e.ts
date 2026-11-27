import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

import {
    cardText,
    NOTE,
    openReview,
    pluginId,
    readNote,
    setSettings,
    TAG,
    useNote,
    waitForPlugin,
} from "../card-syntax-helpers";

// Image cloze (#28): masks asked by card number or overlap letters, with hints, sharing card numbers with the text
// clozes of their paragraph. Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.
// Set SCREENSHOTS=1 to also save screenshots to docs/media/screenshots.

const SCREENSHOT_DIR = path.resolve("docs/media/screenshots");
const takeScreenshots = process.env.SCREENSHOTS === "1";

const COMMENT = "<!--SR:!2030-01-01,3,250,c=1!2030-01-02,3,250,c=2-->";

function block(...masks: string[]): string {
    return ["```image-cloze", "image: [[Heart.png]]", "mode: hide-all", ...masks, "```"].join("\n");
}

// The boxes of two labels of tests/e2e/vault/CIA/Part1/Heart.png, as in occlusion.e2e.ts
const RIGHT_ATRIUM = "rect 0.1440 0.2891 0.2520 0.0984";
const LEFT_ATRIUM = "rect 0.6180 0.2891 0.2240 0.0875";

const COMBINED = [
    TAG,
    "",
    "Blood comes back into the ==1;;right atrium== and the ==2;;left atrium==.",
    block(`mask: 1 | ra ${RIGHT_ATRIUM} | chamber`, `mask: 2 | la ${LEFT_ATRIUM} |`),
    "",
].join("\n");

async function isMobile(): Promise<boolean> {
    return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

async function screenshot(name: string): Promise<void> {
    if (!takeScreenshots) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await browser.execute(() => {
        document.querySelectorAll(".notice").forEach((notice) => notice.remove());
    });
    const device = (await isMobile()) ? "mobile" : "desktop";
    await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `image-cloze-${name}-${device}.png`));
}

async function picturesLoaded(selector: string): Promise<void> {
    await browser.waitUntil(
        () =>
            browser.execute((sel: string) => {
                const pictures = Array.from(document.querySelectorAll<HTMLImageElement>(sel));
                return (
                    pictures.length > 0 &&
                    pictures.every((img) => img.complete && img.naturalWidth > 0)
                );
            }, selector),
        { timeoutMsg: `the picture ${selector} did not load` },
    );
    await browser.pause(300);
}

/** The image cloze card that is up: its masks' classes and the text on them. */
async function shownPicture(): Promise<{
    classes: string;
    masks: (string | null)[];
    tags: string[];
}> {
    return browser.execute(() => {
        const card = Array.from(
            document.querySelectorAll<HTMLElement>(".fs-view .fs-card-container .fs-occ"),
        ).find((el) => el.offsetParent !== null);
        return {
            classes: card?.className ?? "",
            masks: Array.from(card?.querySelectorAll(".fs-mask") ?? []).map((mask) =>
                mask.getAttribute("class"),
            ),
            tags: Array.from(card?.querySelectorAll(".fs-occ-tag") ?? []).map(
                (tag) => tag.textContent ?? "",
            ),
        };
    });
}

async function cardShown(): Promise<void> {
    await browser
        .$(".fs-view .fs-card-container .fs-show-answer-button")
        .waitForClickable({ timeoutMsg: "no card was shown" });
    await picturesLoaded(".fs-view .fs-card-container .fs-occ-image");
}

async function showAnswer(): Promise<void> {
    await browser.$(".fs-view .fs-card-container .fs-show-answer-button").click();
    await browser.$(".fs-view .fs-card-container .fs-easy-button").waitForClickable({
        timeoutMsg: "the answer buttons were not shown",
    });
    await picturesLoaded(".fs-view .fs-card-container .fs-occ-image");
}

async function openNote(): Promise<void> {
    await browser.executeObsidian(async ({ app }, notePath) => {
        const file = app.vault.getFileByPath(notePath);
        if (file === null) throw new Error(`${notePath} is not in the vault`);
        await app.workspace.getLeaf(false).setViewState({
            type: "markdown",
            state: { file: file.path, mode: "preview" },
            active: true,
        });
    }, NOTE);
}

describe("image cloze", function () {
    before(waitForPlugin);

    beforeEach(async function () {
        await setSettings({
            dailyLimitsEnabled: false,
            flashcardCardOrder: "NewFirstSequential",
            flashcardTags: [TAG],
            typeAnswers: false,
        });
    });

    afterEach(async function () {
        await browser.keys("Escape");
    });

    after(async function () {
        await setSettings({ flashcardTags: ["#flashcards"], typeAnswers: false });
        await obsidianPage.resetVault();
    });

    it("text and picture share card numbers: card 1 asks text cloze 1 and mask 1 together, the back shows both", async function () {
        await useNote(COMBINED);
        await openReview();
        await cardShown();

        // Front: text cloze 1 asked, cloze 2 shown; mask 1 filled with its hint, mask 2 hidden (hide all)
        let text = await cardText();
        expect(text).toContain("[...]");
        expect(text).toContain("left atrium");
        expect(text).not.toContain("right atrium");
        let picture = await shownPicture();
        expect(picture.classes).toContain("is-cloze");
        expect(picture.classes).toContain("is-front");
        expect(picture.masks).toHaveLength(2);
        expect(picture.masks.filter((mask) => mask?.includes("is-active"))).toHaveLength(1);
        expect(picture.tags).toEqual(["chamber"]);
        // The card opens at its text: the cloze it asks is in view, not scrolled past to reach the picture
        const textInView = await browser.execute(() => {
            const host = document.querySelector<HTMLElement>(
                ".fs-view .fs-card-container .fs-content",
            );
            if (host === null) return false;
            const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
                if (!(node.textContent ?? "").includes("Blood comes back")) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const line = range.getBoundingClientRect();
                const box = host.getBoundingClientRect();
                return line.top >= box.top - 1 && line.bottom <= box.bottom + 1;
            }
            return false;
        });
        expect(textInView).toBe(true);
        await screenshot("front");

        // Back: the text's answer and the mask outlined; no answer line under the picture
        await showAnswer();
        text = await cardText();
        expect(text).toContain("right atrium");
        picture = await shownPicture();
        expect(picture.classes).toContain("is-back");
        expect(picture.masks.filter((mask) => mask?.includes("is-revealed"))).toHaveLength(1);
        expect(await browser.$(".fs-view .fs-card-container .fs-occ-answer").isExisting()).toBe(
            false,
        );
        await screenshot("back");
    });

    it("a block alone with overlap letters: each card asks the mask with an a there", async function () {
        await useNote(
            [
                TAG,
                "",
                block(
                    `mask: as | ra ${RIGHT_ATRIUM} | first`,
                    `mask: sa | la ${LEFT_ATRIUM} | second`,
                ),
                "",
            ].join("\n"),
        );
        await openReview();
        await cardShown();
        const picture = await shownPicture();
        // Card 1: the first mask asked; the second shown (s), so not drawn
        expect(picture.masks).toHaveLength(1);
        expect(picture.tags).toEqual(["first"]);
    });

    it("a long hint on a small mask is cut with an ellipsis, and a tap shows it whole in a bubble", async function () {
        const hint = "a long hint that goes on ".repeat(8).trim();
        await useNote(
            [TAG, "", block(`mask: 1 | ra rect 0.4000 0.4000 0.0800 0.0800 | ${hint}`), ""].join(
                "\n",
            ),
        );
        await openReview();
        await cardShown();
        const fit = await browser.execute(() => {
            const card = ".fs-view .fs-card-container";
            const mask = document
                .querySelector(`${card} .fs-mask.is-active`)
                ?.getBoundingClientRect();
            const tag = document.querySelector(`${card} .fs-occ-tag`)?.getBoundingClientRect();
            const span = document.querySelector<HTMLElement>(`${card} .fs-occ-tag-text`);
            const title =
                document.querySelector(`${card} .fs-occ-tag`)?.getAttribute("title") ?? "";
            if (mask === undefined || tag === undefined || span === null) return null;
            return {
                inside:
                    tag.left >= mask.left - 1 &&
                    tag.top >= mask.top - 1 &&
                    tag.right <= mask.right + 1 &&
                    tag.bottom <= mask.bottom + 1,
                cut: getComputedStyle(span).textOverflow === "ellipsis",
                title,
            };
        });
        expect(fit).not.toBeNull();
        expect(fit?.inside).toBe(true);
        expect(fit?.cut).toBe(true);
        expect(fit?.title).toBe(hint);
        await screenshot("long-hint");

        // A tap opens a bubble with the whole hint, inside the picture, and the card stays on its front
        await browser.$(".fs-view .fs-card-container .fs-occ-tag").click();
        const bubble = await browser.execute(() => {
            const card = ".fs-view .fs-card-container";
            const el = document.querySelector<HTMLElement>(`${card} .fs-occ-hint-bubble`);
            const stage = document.querySelector(`${card} .fs-occ-stage`)?.getBoundingClientRect();
            if (el === null || stage === undefined) return null;
            const box = el.getBoundingClientRect();
            return {
                text: el.textContent ?? "",
                inside:
                    box.left >= stage.left - 1 &&
                    box.right <= stage.right + 1 &&
                    box.top >= stage.top - 1 &&
                    box.bottom <= stage.bottom + 1,
                // A solid background of its own, so it reads over the picture
                solid: /^rgb\(/.test(getComputedStyle(el).backgroundColor),
            };
        });
        expect(bubble).toEqual({ text: hint, inside: true, solid: true });
        expect(
            await browser.$(".fs-view .fs-card-container .fs-show-answer-button").isDisplayed(),
        ).toBe(true);
        await screenshot("long-hint-tapped");
    });

    it("edits a block in the note: only the block's lines change, the text and the schedule comment stay", async function () {
        await useNote(COMBINED.replace("|\n```", "|\n```\n" + COMMENT));
        const before = readNote();
        await openNote();
        await picturesLoaded(".markdown-reading-view .fs-occ-image");
        expect(
            await browser.execute(() =>
                Array.from(
                    document.querySelectorAll(".markdown-reading-view .fs-occ-tag"),
                    (tag) => tag.textContent,
                ),
            ),
        ).toEqual(["1 · chamber", "2"]);
        await screenshot("note");

        await browser.$(".markdown-reading-view .fs-occ").moveTo();
        await browser.$(".markdown-reading-view .fs-occ-edit").click();
        await browser
            .$(".fs-occ-editor-modal")
            .waitForDisplayed({ timeoutMsg: "the editor did not open" });
        await picturesLoaded(".fs-occ-editor .fs-occ-image");
        // Nothing is wrong: no problem line
        expect(await browser.$(".fs-occ-editor .fs-occ-problem").isDisplayed()).toBe(false);
        await browser.$$(".fs-occ-editor .fs-occ-chip")[1].click();
        // Card field, then hint. A hint holding a comment is named as it is typed
        await browser.$$(".fs-occ-editor .fs-occ-input")[1].setValue("bad <!-- hint");
        expect(await browser.$(".fs-occ-editor .fs-occ-problem").isDisplayed()).toBe(true);
        await browser.$$(".fs-occ-editor .fs-occ-input")[1].setValue("other chamber");
        expect(await browser.$(".fs-occ-editor .fs-occ-problem").isDisplayed()).toBe(false);
        await screenshot("editor");
        await browser.$(".fs-occ-editor .fs-occ-btn.is-primary").click();
        await browser.$(".fs-occ-editor-modal").waitForExist({ reverse: true });

        await browser.waitUntil(() => readNote().includes("| other chamber"), {
            timeoutMsg: "the edit was never written to the note",
        });
        const after = readNote().split("\n");
        const was = before.split("\n");
        expect(after).toHaveLength(was.length);
        expect(after.filter((line, at) => line !== was[at])).toEqual([
            `mask: 2 | la ${LEFT_ATRIUM} | other chamber`,
        ]);
    });

    it("edits from review with the card fields locked", async function () {
        await useNote(COMBINED);
        await openReview();
        await cardShown();
        await browser.execute(() => {
            const button = document.querySelector<HTMLElement>(".fs-view .fs-edit-button");
            if (button === null) throw new Error("no Edit card button");
            button.click();
        });
        await browser
            .$(".fs-occ-editor-modal")
            .waitForDisplayed({ timeoutMsg: "the image editor did not open" });
        await picturesLoaded(".fs-occ-editor .fs-occ-image");
        await browser.$$(".fs-occ-editor .fs-occ-chip")[0].click();
        expect(await browser.$$(".fs-occ-editor .fs-occ-input")[0].isEnabled()).toBe(false);
        expect(await browser.$(".fs-occ-editor .fs-occ-btn.is-danger").isExisting()).toBe(false);
        await browser.$$(".fs-occ-editor .fs-occ-input")[1].setValue("chamber, edited");
        await browser.$(".fs-occ-editor .fs-occ-btn.is-primary").click();
        await browser.$(".fs-occ-editor-modal").waitForExist({ reverse: true });
        await browser.waitUntil(() => readNote().includes("| chamber, edited"), {
            timeoutMsg: "the edit was never written to the note",
        });
        expect(readNote()).toContain(
            "Blood comes back into the ==1;;right atrium== and the ==2;;left atrium==.",
        );
    });

    it("Add image cloze opens the image picker, then the editor with a card field and a hint for each mask", async function () {
        await useNote([TAG, "", "Some notes about the heart.", ""].join("\n"));
        await browser.executeObsidian(async ({ app }, notePath) => {
            const file = app.vault.getFileByPath(notePath);
            if (file === null) throw new Error(`${notePath} is not in the vault`);
            await app.workspace.getLeaf(false).setViewState({
                type: "markdown",
                state: { file: file.path, mode: "source" },
                active: true,
            });
            app.workspace.activeEditor?.editor?.setCursor({ line: 3, ch: 0 });
        }, NOTE);
        await browser.executeObsidianCommand(`${pluginId}:fs-add-image-cloze`);
        const picker = browser.$(".prompt .prompt-input");
        await picker.waitForDisplayed({ timeoutMsg: "the image picker did not open" });
        await picker.setValue("Heart");
        await browser.$(".prompt .suggestion-item").waitForDisplayed();
        await browser.keys("Enter");
        await browser
            .$(".fs-occ-editor-modal")
            .waitForDisplayed({ timeoutMsg: "the editor did not open" });
        const labels = await browser.execute(() =>
            Array.from(
                document.querySelectorAll(".fs-occ-editor .fs-occ-field-label"),
                (el) => el.textContent,
            ),
        );
        expect(labels).toEqual(["Cards for this mask", "Hint", "Question"]);
        expect(await browser.$(".fs-occ-editor-modal .modal-title").getText()).toBe("Image cloze");
    });

    it("typed answers: a field for the text cloze only, none for the picture", async function () {
        await setSettings({ typeAnswers: true });
        await useNote(COMBINED);
        await openReview();
        await cardShown();
        expect(await browser.$$(".fs-view .fs-card-container .cloze-input")).toHaveLength(1);
        expect(await browser.$(".fs-view .fs-card-container .fs-typed-input").isExisting()).toBe(
            false,
        );
    });
});
