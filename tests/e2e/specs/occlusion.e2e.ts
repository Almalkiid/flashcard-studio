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

/** Draws a mask over a box of the picture in the editor. */
async function drawMask(
    fraction: { x: number; y: number; w: number; h: number },
    pointerType: "mouse" | "touch",
): Promise<void> {
    // The editor slides in on a phone: draw when the picture has stopped moving
    let stage = await boxOf(".fs-occ-editor .fs-occ-stage");
    for (let tries = 0; tries < 20; tries++) {
        await browser.pause(100);
        const later = await boxOf(".fs-occ-editor .fs-occ-stage");
        const moved = Math.abs(later.top - stage.top) + Math.abs(later.left - stage.left);
        stage = later;
        if (moved < 0.5) break;
        console.log(`the picture was still moving by ${moved}px`);
    }
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
        for (const light of [false, true]) {
            await setTheme(light);
            await screenshot("occlusion-front", light);
        }
        await setTheme(false);

        // On a phone a tap on the picture zooms it, and is not a tap on the card: the answer stays hidden
        if (await isMobile()) {
            const stage = ".sr-view .sr-card-container .fs-occ-stage";
            await browser.$(`${stage} .fs-occ-image`).click();
            await browser.waitUntil(async () =>
                (await browser.$(stage).getAttribute("class")).includes("is-zoomed"),
            );
            await browser.pause(200);
            expect((await shownCard()).classes).toContain("is-front");
            await browser.$(`${stage} .fs-occ-image`).click();
            await browser.waitUntil(
                async () => !(await browser.$(stage).getAttribute("class")).includes("is-zoomed"),
            );
        }

        // Back: the same picture once, the mask outlined, its label in it and under the picture
        await showAnswer();
        await picturesLoaded(".sr-view .sr-card-container .fs-occ-image");
        card = await shownCard();
        expect(card.classes).toContain("is-back");
        expect(card.pictures).toBe(1);
        expect(card.masks[0]).toContain("is-revealed");
        expect(card.masks[0]).not.toContain("is-active");
        expect(card.tags).toEqual(["Right atrium"]);
        expect(card.answer).toBe("Right atrium");
        await expectActiveMaskAt(RIGHT_ATRIUM, "is-back");
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
        await showAnswer();
        card = await shownCard();
        expect(card.masks[1]).toContain("is-revealed");
        expect(card.tags).toEqual(["Left ventricle"]);
        expect(card.answer).toBe("Left ventricle");
        expect(
            await browser.execute(
                () =>
                    document.querySelector(".sr-view .sr-card-container .fs-occ-answer strong")
                        ?.textContent,
            ),
        ).toBe("ventricle");
        await answerEasy();
        await browser.waitUntil(() => readNote().includes("<!--SR:"), {
            timeoutMsg: "the schedule was never written to the note",
        });

        // Both schedules are in the one comment after the block, in mask order, and the block itself is untouched
        const text = readNote();
        expect(text).toContain(BLOCK + "\n<!--SR:");
        const comments = text.match(/<!--SR:(![^!>]+)+-->/g) ?? [];
        expect(comments).toHaveLength(1);
        expect(comments[0]?.split("!").filter((part) => part.startsWith("fsrs"))).toHaveLength(2);
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
        await picturesLoaded(".fs-occ-editor .fs-occ-image");
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
        await picturesLoaded(".fs-occ-editor .fs-occ-image");
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
