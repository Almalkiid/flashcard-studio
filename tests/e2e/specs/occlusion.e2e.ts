import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

import {
    answerEasy,
    NOTE,
    openReview,
    pluginId,
    readNote,
    setSettings,
    TAG,
    useNote,
    waitForPlugin,
} from "../card-syntax-helpers";

// Image occlusion: reviewing the cards of a block, editing a block in a note, and adding one with the command.
// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.
// Set SCREENSHOTS=1 to also save README screenshots to docs/media/screenshots.

const SCREENSHOT_DIR = path.resolve("docs/media/screenshots");
const takeScreenshots = process.env.SCREENSHOTS === "1";

// The picture is tests/e2e/vault/CIA/Part1/Heart.png (built by tests/e2e/fixtures/build-heart-image.py). These are
// the boxes of two of its labels, as fractions of the picture.
const RIGHT_ATRIUM = { x: 0.144, y: 0.2891, w: 0.252, h: 0.0984 };
const LEFT_ATRIUM = { x: 0.618, y: 0.2891, w: 0.224, h: 0.0875 };

const MASK_LINES = [
    "mask: ra rect 0.1440 0.2891 0.2520 0.0984 | Right atrium",
    "mask: lv ellipse 0.5500 0.6600 0.3600 0.1600 | Left **ventricle**",
];
const BLOCK = [
    "```image-occlusion",
    "image: [[Heart.png]]",
    "mode: hide-all",
    "question: Name the labelled chamber",
    ...MASK_LINES,
    "```",
].join("\n");

interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

async function isMobile(): Promise<boolean> {
    return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

async function setTheme(light: boolean): Promise<void> {
    await browser.execute((useLight: boolean) => {
        document.body.classList.toggle("theme-light", useLight);
        document.body.classList.toggle("theme-dark", !useLight);
    }, light);
    await browser.pause(150);
}

async function screenshot(name: string, light: boolean): Promise<void> {
    if (!takeScreenshots) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    // Obsidian's notices would cover the top of the screen
    await browser.execute(() => {
        document.querySelectorAll(".notice").forEach((notice) => notice.remove());
    });
    const device = (await isMobile()) ? "mobile" : "desktop";
    await browser.saveScreenshot(
        path.join(SCREENSHOT_DIR, `${name}${light ? "-light" : ""}-${device}.png`),
    );
}

/** Waits until every picture that matches has loaded, so that the masks are on a picture of its final size. */
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
    await browser.pause(150);
}

async function boxOf(selector: string): Promise<Box> {
    return browser.execute((sel: string) => {
        const rect = document.querySelector(sel)?.getBoundingClientRect();
        if (rect === undefined) throw new Error(`${sel} is not on the page`);
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }, selector);
}

/** The card that is up: what is drawn, of the picture that is shown (the study screen keeps one at a time). */
async function shownCard(): Promise<{
    classes: string;
    question: string;
    masks: (string | null)[];
    tags: string[];
    answer: string;
    pictures: number;
}> {
    return browser.execute(() => {
        const shown = Array.from(
            document.querySelectorAll<HTMLElement>(".sr-view .sr-card-container .fs-occ"),
        ).filter((el) => el.offsetParent !== null);
        const card = shown[0];
        return {
            classes: card?.className ?? "",
            question: card?.querySelector(".fs-occ-question")?.textContent ?? "",
            masks: Array.from(card?.querySelectorAll(".fs-mask") ?? []).map((mask) =>
                mask.getAttribute("class"),
            ),
            tags: Array.from(card?.querySelectorAll(".fs-occ-tag") ?? []).map(
                (tag) => tag.textContent ?? "",
            ),
            answer: card?.querySelector(".fs-occ-answer")?.textContent ?? "",
            pictures: shown.length,
        };
    });
}

async function showAnswer(): Promise<void> {
    const button = browser.$(".sr-view .sr-card-container .sr-show-answer-button");
    await button.waitForClickable({ timeoutMsg: "the Show answer button was not shown" });
    await button.click();
    await browser.$(".sr-view .sr-card-container .sr-easy-button").waitForClickable({
        timeoutMsg: "the answer buttons were not shown",
    });
    await browser.pause(300);
}

/** Checks that the mask the card asks about is on the picture where the block put it. */
async function expectActiveMaskAt(
    fraction: { x: number; y: number; w: number; h: number },
    side: "is-front" | "is-back",
) {
    const card = `.sr-view .sr-card-container .fs-occ.${side}`;
    const stage = await boxOf(`${card} .fs-occ-stage`);
    const mask = await boxOf(`${card} .fs-mask.is-active, ${card} .fs-mask.is-revealed`);
    expect(Math.abs(mask.left - (stage.left + fraction.x * stage.width))).toBeLessThan(2);
    expect(Math.abs(mask.top - (stage.top + fraction.y * stage.height))).toBeLessThan(2);
    expect(Math.abs(mask.width - fraction.w * stage.width)).toBeLessThan(2);
    expect(Math.abs(mask.height - fraction.h * stage.height)).toBeLessThan(2);
}

/**
 * The card scrolls to the mask that it asks about once its picture has loaded: the mask is inside the card's visible scroll
 * area, and on the back it is not under the answer, which stays in view at the bottom. Nobody scrolls by hand.
 */
async function expectMaskInView(): Promise<void> {
    const measure = () =>
        browser.execute(() => {
            const card = ".sr-view .sr-card-container";
            const host = document.querySelector<HTMLElement>(`${card} .sr-content`);
            const mask = document.querySelector(
                `${card} .fs-mask.is-active, ${card} .fs-mask.is-revealed`,
            );
            if (host === null || mask === null) return null;
            const area = host.getBoundingClientRect();
            const at = mask.getBoundingClientRect();
            const answer = document
                .querySelector(`${card} .fs-occ-answer`)
                ?.getBoundingClientRect();
            return {
                above: at.top - area.top,
                below: area.bottom - at.bottom,
                left: at.left - area.left,
                right: area.right - at.right,
                // Room between the mask and the answer that stays at the bottom, when there is one
                clear: answer === undefined ? 1 : answer.top - at.bottom,
                scrollTop: Math.round(host.scrollTop),
                scrollable: host.scrollHeight > host.clientHeight + 2,
            };
        });
    let last: unknown = null;
    await browser
        .waitUntil(
            async () => {
                const box = (last = await measure());
                return (
                    box !== null &&
                    box.above >= 0 &&
                    box.below >= 0 &&
                    box.left >= 0 &&
                    box.right >= 0 &&
                    box.clear >= 0
                );
            },
            { timeout: 5000 },
        )
        .catch(() => {
            throw new Error(`the mask is not in view of the card: ${JSON.stringify(last)}`);
        });
}

/**
 * The picture is as wide as the card's content, up to its own width (the picture is 1000 px wide). The block has a little
 * padding of its own in the study look, so the picture is compared with the block's content, and the block with the card's.
 */
async function expectPictureAsWideAsTheCard(): Promise<void> {
    const sizes = await browser.execute(() => {
        const card = ".sr-view .sr-card-container";
        const host = document.querySelector<HTMLElement>(`${card} .sr-content`);
        const block = document.querySelector<HTMLElement>(`${card} .fs-occ`);
        const stage = document.querySelector<HTMLElement>(`${card} .fs-occ-stage`);
        if (host === null || block === null || stage === null) return null;
        const inner = (el: HTMLElement) => {
            const style = getComputedStyle(el);
            return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        };
        return {
            stage: stage.getBoundingClientRect().width,
            block: inner(block),
            blockOuter: block.getBoundingClientRect().width,
            card: inner(host),
        };
    });
    expect(sizes).not.toBeNull();
    // The picture fills the block, unless it is smaller than that
    expect(Math.abs((sizes?.stage ?? 0) - Math.min(1000, sizes?.block ?? 0))).toBeLessThan(2);
    // The block fills the card
    expect(Math.abs((sizes?.blockOuter ?? 0) - (sizes?.card ?? 0))).toBeLessThan(2);
}

async function openNote(mode: "preview" | "source"): Promise<void> {
    await browser.executeObsidian(
        async ({ app }, notePath, viewMode) => {
            const file = app.vault.getFileByPath(notePath);
            if (file === null) throw new Error(`${notePath} is not in the vault`);
            const leaf = app.workspace.getLeaf(false);
            await leaf.setViewState({
                type: "markdown",
                state: { file: file.path, mode: viewMode },
                active: true,
            });
        },
        NOTE,
        mode,
    );
}

/** A drag with a finger or a mouse: what the editor's pointer events are for. */
async function drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    pointerType: "mouse" | "touch",
): Promise<void> {
    await browser
        .action("pointer", { parameters: { pointerType } })
        .move({ x: Math.round(from.x), y: Math.round(from.y) })
        .down()
        .move({
            x: Math.round((from.x + to.x) / 2),
            y: Math.round((from.y + to.y) / 2),
            duration: 100,
        })
        .move({ x: Math.round(to.x), y: Math.round(to.y), duration: 100 })
        .up()
        .perform();
}

/**
 * Waits until a box has stopped moving. The editor slides in on a phone, and a click or a drag that is aimed at where
 * something was while it moves misses it.
 */
async function waitUntilStill(selector: string): Promise<Box> {
    let box = await boxOf(selector);
    for (let tries = 0; tries < 30; tries++) {
        await browser.pause(100);
        const later = await boxOf(selector);
        const moved = Math.abs(later.top - box.top) + Math.abs(later.left - box.left);
        box = later;
        if (moved < 0.5) break;
        console.log(`${selector} was still moving by ${moved}px`);
    }
    return box;
}

/** The editor is open, its picture is loaded, and it is not sliding in any more. */
async function editorReady(): Promise<void> {
    await picturesLoaded(".fs-occ-editor .fs-occ-image");
    await waitUntilStill(".fs-occ-editor .fs-occ-stage");
}

/** Draws a mask over a box of the picture in the editor. */
async function drawMask(
    fraction: { x: number; y: number; w: number; h: number },
    pointerType: "mouse" | "touch",
): Promise<void> {
    const stage = await waitUntilStill(".fs-occ-editor .fs-occ-stage");
    await drag(
        {
            x: stage.left + fraction.x * stage.width,
            y: stage.top + fraction.y * stage.height,
        },
        {
            x: stage.left + (fraction.x + fraction.w) * stage.width,
            y: stage.top + (fraction.y + fraction.h) * stage.height,
        },
        pointerType,
    );
}

const NOTE_TEXT = [TAG, "", BLOCK, ""].join("\n");

describe("image occlusion", function () {
    before(waitForPlugin);

    beforeEach(async function () {
        await setSettings({
            dailyLimitsEnabled: false,
            flashcardCardOrder: "NewFirstSequential",
            flashcardTags: [TAG],
        });
        await setTheme(false);
    });

    afterEach(async function () {
        await browser.keys("Escape");
    });

    after(async function () {
        await setSettings({ flashcardTags: ["#flashcards"] });
        await obsidianPage.resetVault();
    });

    it("reviews the cards of a block: the mask asked about is filled on the front and outlined, with its label, on the back", async function () {
        await useNote(NOTE_TEXT);
        expect(readNote()).not.toContain("<!--SR:");
        await openReview();

        // Front of the first card: the question, the picture with both masks, "?" on the one that is asked about
        await browser
            .$(".sr-view .sr-card-container .sr-show-answer-button")
            .waitForClickable({ timeoutMsg: "no card was shown" });
        await picturesLoaded(".sr-view .sr-card-container .fs-occ-image");
        let card = await shownCard();
        expect(card.classes).toContain("is-front");
        expect(card.question).toBe("Name the labelled chamber");
        expect(card.masks).toHaveLength(2);
        expect(card.masks.filter((mask) => mask?.includes("is-active"))).toHaveLength(1);
        expect(card.masks[0]).toContain("is-active");
        expect(card.tags).toEqual(["?"]);
        expect(card.answer).toBe("");
        await expectActiveMaskAt(RIGHT_ATRIUM, "is-front");
        await expectPictureAsWideAsTheCard();
        await expectMaskInView();
        for (const light of [false, true]) {
            await setTheme(light);
            await screenshot("occlusion-front", light);
        }
        await setTheme(false);

        // Card info shows the card as its question and the label of its mask, not the data it is made of
        await browser.executeObsidianCommand(`${pluginId}:srs-card-info`);
        await browser
            .$(".modal.sr-card-info-modal")
            .waitForDisplayed({ timeoutMsg: "card info did not open" });
        expect(await browser.$(".sr-card-info-front").getText()).toBe(
            "Name the labelled chamber · Right atrium",
        );
        await browser.keys("Escape");
        await browser.$(".modal.sr-card-info-modal").waitForExist({ reverse: true });

        // A click or a tap on the picture zooms it, and is not a click on the card: the answer stays hidden. Zoomed, the
        // picture is larger but never more than twice its own width, and the mask is still in view
        {
            const stage = ".sr-view .sr-card-container .fs-occ-stage";
            const widthOf = () =>
                browser.execute(
                    (sel: string) =>
                        document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
                    stage,
                );
            const before = await widthOf();
            await browser.$(`${stage} .fs-occ-image`).click();
            await browser.waitUntil(async () =>
                ((await browser.$(stage).getAttribute("class")) ?? "").includes("is-zoomed"),
            );
            await browser.pause(200);
            expect((await shownCard()).classes).toContain("is-front");
            const zoomed = await widthOf();
            expect(zoomed).toBeGreaterThan(before + 10);
            expect(zoomed).toBeLessThanOrEqual(2000 + 1);
            await expectMaskInView();
            await browser.$(`${stage} .fs-occ-image`).click();
            await browser.waitUntil(
                async () =>
                    !((await browser.$(stage).getAttribute("class")) ?? "").includes("is-zoomed"),
            );
            await expectMaskInView();
        }

        // Back: the same picture once, the mask outlined, its label in it and under the picture
        await showAnswer();
        await picturesLoaded(".sr-view .sr-card-container .fs-occ-image");
        card = await shownCard();
        expect(card.classes).toContain("is-back");
        expect(card.pictures).toBe(1);
        expect(card.masks[0]).toContain("is-revealed");
        expect(card.masks[0]).not.toContain("is-active");
        // The label is under the picture only: the picture usually has it written on it already
        expect(card.tags).toEqual([]);
        expect(card.answer).toBe("Right atrium");
        // The revealed mask is an outline with nothing in it
        expect(
            await browser.execute(
                () =>
                    getComputedStyle(
                        document.querySelector(
                            ".sr-view .sr-card-container .fs-mask.is-revealed",
                        ) as Element,
                    ).fill,
            ),
        ).toBe("rgba(0, 0, 0, 0)");
        await expectActiveMaskAt(RIGHT_ATRIUM, "is-back");
        await expectPictureAsWideAsTheCard();
        await expectMaskInView();
        for (const light of [false, true]) {
            await setTheme(light);
            await screenshot("occlusion-back", light);
        }
        await setTheme(false);
        await answerEasy();

        // The second card is about the other mask, an ellipse, and its label is Markdown
        await browser
            .$(".sr-view .sr-card-container .sr-show-answer-button")
            .waitForClickable({ timeoutMsg: "the second card was not shown" });
        await picturesLoaded(".sr-view .sr-card-container .fs-occ-image");
        card = await shownCard();
        expect(card.classes).toContain("is-front");
        expect(card.masks[1]).toContain("is-active");
        expect(card.masks[0]).not.toContain("is-active");
        // This mask is in the lower half of the picture
        await expectMaskInView();
        await showAnswer();
        card = await shownCard();
        expect(card.masks[1]).toContain("is-revealed");
        expect(card.tags).toEqual([]);
        expect(card.answer).toBe("Left ventricle");
        await expectMaskInView();
        expect(
            await browser.execute(
                () =>
                    document.querySelector(".sr-view .sr-card-container .fs-occ-answer strong")
                        ?.textContent,
            ),
        ).toBe("ventricle");
        await answerEasy();
        // Until both cards have a schedule: the note is written after each answer, and read in between it can be empty
        await browser.waitUntil(
            () => {
                const written = readNote();
                return written.includes("<!--SR:") && !written.includes("fsrs,-,");
            },
            { timeoutMsg: "the schedules were never written to the note" },
        );

        // Both schedules are in the one comment after the block, in mask order, and the block itself is untouched
        const text = readNote();
        expect(text).toContain(BLOCK + "\n<!--SR:");
        const comments = text.match(/<!--SR:(![^!>]+)+-->/g) ?? [];
        expect(comments).toHaveLength(1);
        expect(comments[0]?.split("!").filter((part) => part.startsWith("fsrs"))).toHaveLength(2);
    });

    it("reviews in a tab on a desktop: the picture is as wide as the card and the mask is in view", async function () {
        if (await isMobile()) this.skip();
        await useNote(NOTE_TEXT);
        await setSettings({ openViewInNewTab: true });
        try {
            await openReview();
            await browser
                .$(".sr-view .sr-card-container .sr-show-answer-button")
                .waitForClickable({ timeoutMsg: "no card was shown" });
            await picturesLoaded(".sr-view .sr-card-container .fs-occ-image");
            await expectPictureAsWideAsTheCard();
            await expectMaskInView();
            for (const light of [false, true]) {
                await setTheme(light);
                await screenshot("occlusion-front-tab", light);
            }
            await setTheme(false);

            await showAnswer();
            await picturesLoaded(".sr-view .sr-card-container .fs-occ-image");
            await expectPictureAsWideAsTheCard();
            await expectMaskInView();
            for (const light of [false, true]) {
                await setTheme(light);
                await screenshot("occlusion-back-tab", light);
            }
            await setTheme(false);
        } finally {
            await setSettings({ openViewInNewTab: false });
            // The review is in a tab of its own: close it, so that the next test opens its own
            await browser.executeObsidian(({ app }) =>
                app.workspace.detachLeavesOfType("spaced-repetition-tab-view"),
            );
        }
    });

    it("edits an occlusion card from the study screen: the masks are locked, the answer is changed and written", async function () {
        await useNote(NOTE_TEXT);
        await openReview();
        await browser
            .$(".sr-view .sr-card-container .sr-show-answer-button")
            .waitForClickable({ timeoutMsg: "no card was shown" });
        await picturesLoaded(".sr-view .sr-card-container .fs-occ-image");

        // The Edit card button of the study screen (on a phone it is in the card menu, which has the same handler)
        await browser.execute(() => {
            const button = document.querySelector<HTMLElement>(".sr-view .sr-edit-button");
            if (button === null) throw new Error("no Edit card button");
            button.click();
        });
        await browser
            .$(".fs-occ-editor-modal")
            .waitForDisplayed({ timeoutMsg: "the editor did not open" });
        await editorReady();
        expect(await browser.$$(".fs-occ-editor .fs-occ-emask")).toHaveLength(2);
        // Nothing to delete or to draw with: the cards of the block are in the queue
        expect(await browser.$(".fs-occ-editor .fs-occ-btn.is-danger").isExisting()).toBe(false);
        expect(await browser.$$(".fs-occ-editor .fs-occ-seg")).toHaveLength(1);
        const stage = await boxOf(".fs-occ-editor .fs-occ-stage");
        await drag(
            { x: stage.left + stage.width * 0.05, y: stage.top + stage.height * 0.9 },
            { x: stage.left + stage.width * 0.4, y: stage.top + stage.height * 0.97 },
            (await isMobile()) ? "touch" : "mouse",
        );
        expect(await browser.$$(".fs-occ-editor .fs-occ-emask")).toHaveLength(2);

        await browser.$$(".fs-occ-editor .fs-occ-chip")[0].click();
        await browser.$$(".fs-occ-editor .fs-occ-input")[0].setValue("Right atrium, edited");
        await browser.$(".fs-occ-editor .fs-occ-btn.is-primary").click();
        await browser.$(".fs-occ-editor-modal").waitForExist({ reverse: true });

        await browser.waitUntil(() => readNote().includes("| Right atrium, edited"), {
            timeoutMsg: "the edit was never written to the note",
        });
        const text = readNote();
        expect(text).toContain("mask: ra rect 0.1440 0.2891 0.2520 0.0984 | Right atrium, edited");
        expect(text).toContain(MASK_LINES[1]);
        expect(text.match(/^mask: /gm)).toHaveLength(2);

        // The card on the screen has the new answer
        await showAnswer();
        expect(await browser.$(".sr-view .sr-card-container .fs-occ-answer").getText()).toBe(
            "Right atrium, edited",
        );
    });

    it("saves into the block that was opened when the note has changed, and refuses when it cannot tell which", async function () {
        await useNote(NOTE_TEXT);
        await openNote("preview");
        await picturesLoaded(".markdown-reading-view .fs-occ-image");
        await browser.$(".markdown-reading-view .fs-occ").moveTo();
        await browser.$(".markdown-reading-view .fs-occ-edit").click();
        await browser
            .$(".fs-occ-editor-modal")
            .waitForDisplayed({ timeoutMsg: "the editor did not open" });
        await editorReady();

        // A sync adds two lines above the block while the editor is open: the block is found by what it holds
        await obsidianPage.write(NOTE, [TAG, "", "Added by a sync", "", BLOCK, ""].join("\n"));
        await browser.pause(700);
        await browser.$$(".fs-occ-editor .fs-occ-chip")[0].click();
        await browser.$$(".fs-occ-editor .fs-occ-input")[0].setValue("Found by content");
        await browser.$(".fs-occ-editor .fs-occ-btn.is-primary").click();
        await browser.$(".fs-occ-editor-modal").waitForExist({ reverse: true });
        await browser.waitUntil(() => readNote().includes("| Found by content"), {
            timeoutMsg: "the edit was never written to the note",
        });
        expect(readNote()).toContain("Added by a sync");
        expect(readNote().match(/^mask: /gm)).toHaveLength(2);

        // Someone else changed this very block while the editor is open: nothing is written, and the work is kept
        await browser.$(".markdown-reading-view .fs-occ").moveTo();
        await browser.$(".markdown-reading-view .fs-occ-edit").click();
        await browser.$(".fs-occ-editor-modal").waitForDisplayed();
        await editorReady();
        const theirs = [TAG, "", BLOCK.replace("| Right atrium", "| Changed elsewhere"), ""].join(
            "\n",
        );
        await obsidianPage.write(NOTE, theirs);
        await browser.pause(700);
        await browser.$$(".fs-occ-editor .fs-occ-chip")[1].click();
        await browser.$$(".fs-occ-editor .fs-occ-input")[0].setValue("My unsaved work");
        await browser.$(".fs-occ-editor .fs-occ-btn.is-primary").click();
        await browser.waitUntil(
            () =>
                browser.execute(() =>
                    Array.from(document.querySelectorAll(".notice")).some((notice) =>
                        (notice.textContent ?? "").includes("was not found in the note"),
                    ),
                ),
            { timeoutMsg: "the notice that the block was not found was never shown" },
        );
        expect(await browser.$(".fs-occ-editor-modal").isExisting()).toBe(true);
        expect(await browser.$$(".fs-occ-editor .fs-occ-emask")).toHaveLength(2);
        expect(readNote()).toBe(theirs);
        // Close the editor that was kept open, so that the next test starts without it
        await browser.$(".fs-occ-editor .fs-occ-footer .fs-occ-btn:not(.is-primary)").click();
        await browser.$(".fs-occ-editor-modal").waitForExist({ reverse: true });
    });

    it("shows the answer on the back when the picture is missing", async function () {
        await useNote([TAG, "", BLOCK.replace("[[Heart.png]]", "[[Nowhere.png]]"), ""].join("\n"));
        await openReview();
        const card = ".sr-view .sr-card-container .fs-occ";
        await browser
            .$(".sr-view .sr-card-container .sr-show-answer-button")
            .waitForClickable({ timeoutMsg: "no card was shown" });
        expect(await browser.$(`${card} .fs-occ-missing`).getText()).toContain("Nowhere.png");
        await showAnswer();
        expect(await browser.$(`${card} .fs-occ-missing`).isExisting()).toBe(true);
        expect(await browser.$(`${card} .fs-occ-answer`).getText()).toBe("Right atrium");
    });

    it("edits a block in the note: deleting a mask keeps the other masks' schedules with them", async function () {
        const fsrs = (stability: number) =>
            `!fsrs,2030-01-01T00:00:00.000Z,30,${stability},5,2,3,0,0,2029-12-01T00:00:00.000Z`;
        const threeMasks = [
            "```image-occlusion",
            "image: [[Heart.png]]",
            "mode: hide-all",
            "mask: ra rect 0.1440 0.2891 0.2520 0.0984 | Right atrium",
            "mask: la rect 0.6180 0.2891 0.2240 0.0875 | Left atrium",
            "mask: lv rect 0.5980 0.6953 0.2650 0.0875 | Left ventricle",
            "```",
            `<!--SR:${fsrs(11)}${fsrs(22)}${fsrs(33)}-->`,
        ].join("\n");
        await useNote([TAG, "", threeMasks, ""].join("\n"));
        await openNote("preview");

        // The note shows the picture with every label on its mask
        await picturesLoaded(".markdown-reading-view .fs-occ-image");
        expect(
            await browser.execute(() =>
                Array.from(
                    document.querySelectorAll(".markdown-reading-view .fs-occ-tag"),
                    (tag) => tag.textContent,
                ),
            ),
        ).toEqual(["Right atrium", "Left atrium", "Left ventricle"]);

        // The pencil opens the editor on the block
        await browser.$(".markdown-reading-view .fs-occ").moveTo();
        for (const light of [false, true]) {
            await setTheme(light);
            await screenshot("occlusion-note", light);
        }
        await setTheme(false);
        await browser.$(".markdown-reading-view .fs-occ-edit").click();
        await browser
            .$(".fs-occ-editor-modal")
            .waitForDisplayed({ timeoutMsg: "the editor did not open" });
        await editorReady();
        expect(await browser.$$(".fs-occ-editor .fs-occ-emask")).toHaveLength(3);

        // Select the middle mask by its chip, and delete it
        await browser.$$(".fs-occ-editor .fs-occ-chip")[1].click();
        await browser.$(".fs-occ-editor .fs-occ-btn.is-danger").click();
        expect(await browser.$$(".fs-occ-editor .fs-occ-emask")).toHaveLength(2);
        await browser.$(".fs-occ-editor .fs-occ-btn.is-primary").click();
        await browser.$(".fs-occ-editor-modal").waitForExist({ reverse: true });

        await browser.waitUntil(() => !readNote().includes("mask: la "), {
            timeoutMsg: "the edit was never written to the note",
        });
        const text = readNote();
        expect(text).toContain("mask: ra rect 0.1440 0.2891 0.2520 0.0984 | Right atrium");
        expect(text).toContain("mask: lv rect 0.5980 0.6953 0.2650 0.0875 | Left ventricle");
        // The schedules of the first and the third mask are what is left, in that order
        expect(text).toContain(`\`\`\`\n<!--SR:${fsrs(11)}${fsrs(33)}-->`);
        expect(text).not.toContain(fsrs(22));
    });

    it("adds a block with the command: choose an image, draw and name masks with the pointer, save", async function () {
        await useNote([TAG, "", "Some notes about the heart.", ""].join("\n"));
        await openNote("source");
        await browser.executeObsidian(({ app }) => {
            const editor = app.workspace.activeEditor?.editor;
            if (editor === undefined) throw new Error("no editor is open");
            editor.setCursor({ line: 3, ch: 0 });
        });

        await browser.executeObsidianCommand(`${pluginId}:fs-add-image-occlusion`);
        // The image picker: fuzzy search on the path
        const picker = browser.$(".prompt .prompt-input");
        await picker.waitForDisplayed({ timeoutMsg: "the image picker did not open" });
        await picker.setValue("Heart");
        await browser.$(".prompt .suggestion-item").waitForDisplayed();
        await browser.keys("Enter");

        await browser
            .$(".fs-occ-editor-modal")
            .waitForDisplayed({ timeoutMsg: "the editor did not open" });
        await editorReady();
        // A phone has touch and a desktop a mouse: the pointer events take both
        const pointerType = (await isMobile()) ? "touch" : "mouse";

        await drawMask(RIGHT_ATRIUM, pointerType);
        expect(await browser.$$(".fs-occ-editor .fs-occ-emask")).toHaveLength(1);
        await browser.$$(".fs-occ-editor .fs-occ-input")[0].setValue("Right atrium");

        // The second mask is an ellipse
        await browser.$$(".fs-occ-editor .fs-occ-seg-btn")[1].click();
        await drawMask(LEFT_ATRIUM, pointerType);
        expect(await browser.$$(".fs-occ-editor .fs-occ-emask")).toHaveLength(2);
        expect(await browser.$(".fs-occ-editor .fs-occ-emask.is-ellipse").isExisting()).toBe(true);
        await browser.$$(".fs-occ-editor .fs-occ-input")[0].setValue("Left atrium");

        // A slip of the hand is not a mask
        const stage = await boxOf(".fs-occ-editor .fs-occ-stage");
        await drag(
            { x: stage.left + stage.width * 0.05, y: stage.top + stage.height * 0.9 },
            { x: stage.left + stage.width * 0.05 + 2, y: stage.top + stage.height * 0.9 + 2 },
            pointerType,
        );
        expect(await browser.$$(".fs-occ-editor .fs-occ-emask")).toHaveLength(2);

        // Save is on the screen, however tall the editor is
        const save = await boxOf(".fs-occ-editor .fs-occ-btn.is-primary");
        const windowHeight = await browser.execute(() => window.innerHeight);
        expect(save.top).toBeGreaterThan(0);
        expect(save.top + save.height).toBeLessThanOrEqual(windowHeight);

        await browser.pause(300);
        for (const light of [false, true]) {
            await setTheme(light);
            await screenshot("occlusion-editor", light);
        }
        await setTheme(false);

        await browser.$(".fs-occ-editor .fs-occ-btn.is-primary").click();
        await browser.$(".fs-occ-editor-modal").waitForExist({ reverse: true });

        await browser.waitUntil(() => readNote().includes("image-occlusion"), {
            timeoutMsg: "the block was never written to the note",
        });
        const text = readNote();
        expect(text).toMatch(/```image-occlusion\nimage: \[\[Heart\.png\]\]\nmode: hide-all\n/);
        const masks = text.match(/^mask: .*$/gm) ?? [];
        expect(masks).toHaveLength(2);
        expect(masks[0]).toMatch(
            /^mask: [a-z0-9]{2,6} rect 0\.\d{4} 0\.\d{4} 0\.\d{4} 0\.\d{4} \| Right atrium$/,
        );
        expect(masks[1]).toMatch(
            /^mask: [a-z0-9]{2,6} ellipse 0\.\d{4} 0\.\d{4} 0\.\d{4} 0\.\d{4} \| Left atrium$/,
        );
        // The masks are where they were drawn, to within a few pixels of the picture
        const first = (masks[0] ?? "").split(" ");
        expect(Math.abs(Number(first[3]) - RIGHT_ATRIUM.x)).toBeLessThan(0.02);
        expect(Math.abs(Number(first[4]) - RIGHT_ATRIUM.y)).toBeLessThan(0.02);
        expect(Math.abs(Number(first[5]) - RIGHT_ATRIUM.w)).toBeLessThan(0.02);
        expect(Math.abs(Number(first[6]) - RIGHT_ATRIUM.h)).toBeLessThan(0.02);
        // The text before the block is untouched, and the block is on lines of its own
        expect(text).toContain("Some notes about the heart.\n");
    });
});
