import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

import { openReview, setSettings, TAG, useNote, waitForPlugin } from "../card-syntax-helpers";

// Multiple choice cards and typed answers in the study screen.
// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.
// Set SCREENSHOTS=1 to also save README screenshots to docs/media/screenshots.

// SCREENSHOT_DIR points the screenshots elsewhere, and turns on the extra ones that are not for the README
const SCREENSHOT_DIR = path.resolve(process.env.SCREENSHOT_DIR ?? "docs/media/screenshots");
const extraScreenshots = process.env.SCREENSHOT_DIR !== undefined;
const takeScreenshots = process.env.SCREENSHOTS === "1";

const CARD = ".sr-view .sr-card-container";

const CHOICE_NOTE = [
    TAG,
    "",
    "Which body should approve the internal audit charter?",
    "?",
    "- [ ] The chief audit executive",
    "- [x] The board",
    "- [ ] The external auditor",
    "- [ ] Senior management",
    "Why. The board approves the charter; the CAE drafts it and senior management reviews it.",
    "",
].join("\n");

const MULTI_NOTE = [
    TAG,
    "",
    "Which of these are lines of defence?",
    "?",
    "- [x] Management",
    "- [x] Risk and compliance",
    "- [ ] The audit committee",
    "",
].join("\n");

const TYPED_NOTE = [TAG, "", "What does CAE stand for?::Chief Audit Executive", ""].join("\n");

const CLOZE_NOTE = [TAG, "", "The CAE reports ==functionally== to the ==board==.", ""].join("\n");

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

/** Saves `<name>-<dark|light>-<desktop|mobile>.png` (dark has no theme in its name, like the other screenshots). */
async function screenshot(name: string, light: boolean, extra = false): Promise<void> {
    if (!takeScreenshots || (extra && !extraScreenshots)) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await browser.execute(() => {
        document.querySelectorAll(".notice").forEach((notice) => notice.remove());
    });
    // Let the answer animation finish
    await browser.pause(450);
    await browser.saveScreenshot(
        path.join(
            SCREENSHOT_DIR,
            `${name}${light ? "-light" : ""}-${(await isMobile()) ? "mobile" : "desktop"}.png`,
        ),
    );
}

/**
 * Waits until the review screen has stopped moving. On the phone the review slides up for a quarter of a second, and
 * a click made meanwhile lands where the element used to be.
 */
async function settle(): Promise<void> {
    let last = "";
    let unchanged = 0;
    await browser.waitUntil(
        async () => {
            const now = await browser.execute(
                (selector: string) =>
                    JSON.stringify(document.querySelector(selector)?.getBoundingClientRect()),
                CARD,
            );
            unchanged = now === last ? unchanged + 1 : 0;
            last = now;
            return unchanged >= 3;
        },
        { interval: 80, timeoutMsg: "the review screen never stopped moving" },
    );
}

/** Opens a typed card's review and waits until it is ready for input. */
async function openTypedCard(): Promise<void> {
    await openReview();
    await browser
        .$(`${CARD} .sr-show-answer-button`)
        .waitForClickable({ timeoutMsg: "no card was shown" });
    await settle();
}

/** Opens a review of the note and waits until a multiple choice card is up with all its tiles filled in. */
async function openChoiceCard(tiles: number): Promise<void> {
    await openReview();
    await browser.$(`${CARD} .fs-choice`).waitForDisplayed({ timeoutMsg: "no tiles were shown" });
    await browser.waitUntil(async () => (await browser.$$(`${CARD} .fs-choice`).length) === tiles, {
        timeoutMsg: `expected ${tiles} tiles`,
    });
    await browser.waitUntil(async () => (await tileTexts()).every((text) => text.length > 0), {
        timeoutMsg: "the option text was never rendered",
    });
    await settle();
}

async function tileTexts(): Promise<string[]> {
    return browser.execute((selector: string) => {
        const texts: string[] = [];
        document.querySelectorAll(selector).forEach((el) => texts.push(el.textContent ?? ""));
        return texts;
    }, `${CARD} .fs-choice .fs-choice-text`);
}

async function chooseOption(optionIndex: number): Promise<void> {
    await browser.$(`${CARD} .fs-choice[data-option="${optionIndex}"]`).click();
}

async function waitForBack(): Promise<void> {
    await browser
        .$(`${CARD} .sr-again-button`)
        .waitForDisplayed({ timeoutMsg: "no answer buttons" });
}

/** The suggested rating's button, as the rating it is, or null. */
async function suggestedRating(): Promise<string | null> {
    return browser.execute((selector: string) => {
        const button = document.querySelector(selector);
        if (!button) return null;
        const match = /sr-(again|hard|good|easy)-button/.exec(button.className);
        const tag = button.querySelector(".fs-suggested-tag");
        return match && tag && tag.textContent === "Suggested" ? match[1] : null;
    }, `${CARD} .sr-response-button.fs-suggested`);
}

async function typeAnswer(text: string): Promise<void> {
    const input = browser.$(`${CARD} .fs-typed-input`);
    await input.waitForDisplayed({ timeoutMsg: "no field to type the answer in" });
    await input.click();
    await input.setValue(text);
    await browser.keys("Enter");
    await waitForBack();
}

describe("multiple choice cards and typed answers", function () {
    before(waitForPlugin);

    beforeEach(async function () {
        await setTheme(false);
        await setSettings({
            dailyLimitsEnabled: false,
            flashcardCardOrder: "NewFirstSequential",
            flashcardTags: [TAG],
            shuffleChoices: false,
            typeAnswers: false,
            ignoreAccentsWhenTyping: false,
            reviewLook: "studio",
        });
    });

    afterEach(async function () {
        await browser.keys("Escape");
        await setTheme(false);
    });

    after(async function () {
        await setSettings({
            flashcardTags: ["#flashcards"],
            shuffleChoices: true,
            typeAnswers: false,
        });
        await obsidianPage.resetVault();
    });

    it("shows the options as tiles, and choosing the right one shows the answer and suggests Good", async function () {
        await useNote(CHOICE_NOTE);
        await openChoiceCard(4);

        // The tiles are the way to answer: no Show answer button
        expect(await browser.$(`${CARD} .sr-show-answer-button`).isDisplayed()).toBe(false);
        expect(await browser.$(`${CARD} .fs-choice-kind`).getProperty("textContent")).toBe(
            "Multiple choice",
        );
        expect(await tileTexts()).toEqual([
            "The chief audit executive",
            "The board",
            "The external auditor",
            "Senior management",
        ]);
        await screenshot("choice-front", false);

        await chooseOption(1);
        await waitForBack();

        const right = browser.$(`${CARD} .fs-choice.is-correct`);
        expect(await right.getProperty("textContent")).toContain("The board");
        expect(await right.getAttribute("class")).toContain("is-picked");
        expect(await browser.$$(`${CARD} .fs-choice.is-wrong`).length).toBe(0);
        expect(
            await browser.$(`${CARD} .fs-choice-explanation`).getProperty("textContent"),
        ).toContain("The board approves the charter");
        // The raw checklist is not shown, and the tiles no longer respond
        expect(await browser.$$(`${CARD} .task-list-item-checkbox`).length).toBe(0);
        expect(await browser.$$(`${CARD} button.fs-choice`).length).toBe(0);
        expect(await suggestedRating()).toBe("good");
        // A small window scrolls to the explanation, which would otherwise be below the card's visible part
        await browser.waitUntil(
            () =>
                browser.execute((selector: string) => {
                    const content = document.querySelector(`${selector} .sr-content`);
                    const box = document.querySelector(`${selector} .fs-choice-explanation`);
                    if (!content || !box) return false;
                    return (
                        box.getBoundingClientRect().bottom <=
                        content.getBoundingClientRect().bottom + 1
                    );
                }, CARD),
            { timeoutMsg: "the explanation is not in view" },
        );

        await screenshot("choice-back", false);
        await setTheme(true);
        await screenshot("choice-back", true);
    });

    it("the Classic look shows the tiles and the suggestion too", async function () {
        await setSettings({ reviewLook: "classic" });
        await useNote(CHOICE_NOTE);
        await openChoiceCard(4);
        expect(await browser.$(CARD).getAttribute("class")).toContain("sr-look-classic");
        await screenshot("choice-classic-front", false, true);

        await chooseOption(1);
        await waitForBack();
        expect(await browser.$$(`${CARD} .fs-choice.is-correct`).length).toBe(1);
        expect(await suggestedRating()).toBe("good");
        await screenshot("choice-classic-back", false, true);
        await setTheme(true);
        await screenshot("choice-classic-back", true, true);
    });

    it("a wrong choice is marked, the right one shown, and Again is suggested", async function () {
        await useNote(CHOICE_NOTE);
        await openChoiceCard(4);

        await chooseOption(0);
        await waitForBack();

        expect(await browser.$(`${CARD} .fs-choice.is-wrong`).getProperty("textContent")).toContain(
            "The chief audit executive",
        );
        expect(
            await browser.$(`${CARD} .fs-choice.is-correct`).getProperty("textContent"),
        ).toContain("The board");
        expect(await suggestedRating()).toBe("again");

        await screenshot("choice-wrong", false);
        await setTheme(true);
        await screenshot("choice-wrong", true);
    });

    it("showing the answer without choosing suggests nothing", async function () {
        await useNote(CHOICE_NOTE);
        await openChoiceCard(4);

        if (await isMobile()) {
            // No keyboard on a phone: tapping the card reveals the answer
            await browser.$(`${CARD} .fs-choice-question`).click();
        } else {
            await browser.keys("Space");
        }
        await waitForBack();

        expect(
            await browser.$(`${CARD} .fs-choice.is-correct`).getProperty("textContent"),
        ).toContain("The board");
        expect(await browser.$$(`${CARD} .fs-choice.is-picked`).length).toBe(0);
        expect(await suggestedRating()).toBeNull();
    });

    it("the number keys choose an option on the front, and rate on the back", async function () {
        if (await isMobile()) this.skip();
        await useNote(CHOICE_NOTE);
        await openChoiceCard(4);

        // The order is not shuffled here, so key 2 is "The board"
        await browser.keys("2");
        await waitForBack();
        expect(await browser.$(`${CARD} .fs-choice.is-correct`).getAttribute("class")).toContain(
            "is-picked",
        );
        expect(await suggestedRating()).toBe("good");
    });

    it("shuffles the options when asked, and keeps the marks on the right ones", async function () {
        await setSettings({ shuffleChoices: true });
        await useNote(CHOICE_NOTE);

        // With four options, some order other than the written one turns up within a few tries
        let shuffled = false;
        for (let attempt = 0; attempt < 12 && !shuffled; attempt++) {
            await openChoiceCard(4);
            shuffled = (await tileTexts())[0] !== "The chief audit executive";
            if (shuffled) {
                await chooseOption(1);
                await waitForBack();
                const marked = browser.$(`${CARD} .fs-choice.is-correct`);
                expect(await marked.getProperty("textContent")).toContain("The board");
                expect(await suggestedRating()).toBe("good");
            }
            await browser.keys("Escape");
        }
        expect(shuffled).toBe(true);
    });

    it("a question with several right answers takes a selection and a Check", async function () {
        await useNote(MULTI_NOTE);
        await openChoiceCard(3);

        expect(await browser.$(`${CARD} .fs-choice-hint`).getProperty("textContent")).toBe(
            "Select all that apply",
        );
        const check = browser.$(`${CARD} .fs-choice-check`);
        expect(await check.isEnabled()).toBe(false);

        await chooseOption(0);
        expect(await check.isEnabled()).toBe(true);
        // Choosing does not answer yet
        expect(await browser.$(`${CARD} .sr-again-button`).isDisplayed()).toBe(false);
        await chooseOption(1);
        await check.click();
        await waitForBack();

        expect(await browser.$$(`${CARD} .fs-choice.is-correct.is-picked`).length).toBe(2);
        expect(await suggestedRating()).toBe("good");
    });

    it("a partial selection is not right", async function () {
        await useNote(MULTI_NOTE);
        await openChoiceCard(3);

        await chooseOption(0);
        await browser.$(`${CARD} .fs-choice-check`).click();
        await waitForBack();

        expect(await suggestedRating()).toBe("again");
        // The right option that was left out is still marked
        expect(await browser.$$(`${CARD} .fs-choice.is-correct`).length).toBe(2);
    });

    it("types the answer when the setting is on, and shows what was missing", async function () {
        await setSettings({ typeAnswers: true });
        await useNote(TYPED_NOTE);
        await openTypedCard();

        await typeAnswer("chief audit exec");

        // textContent, not getText: while the answer fades in the driver reports no visible text
        expect(await browser.$(`${CARD} .fs-typed-missing`).getProperty("textContent")).toBe(
            "utive",
        );
        expect(await browser.$(`${CARD} .fs-typed-expected`).getProperty("textContent")).toBe(
            "Chief Audit Executive",
        );
        expect(await suggestedRating()).toBe("again");

        await screenshot("typed-answer", false);
        await setTheme(true);
        await screenshot("typed-answer", true);
    });

    it("an exact answer, whatever its case, suggests Good", async function () {
        await setSettings({ typeAnswers: true });
        await useNote(TYPED_NOTE);
        await openTypedCard();

        await typeAnswer("  chief AUDIT executive. ");

        expect(await browser.$$(`${CARD} .fs-typed-result.is-exact`).length).toBe(1);
        expect(await browser.$$(`${CARD} .fs-typed-wrong`).length).toBe(0);
        expect(await suggestedRating()).toBe("good");
    });

    it("an empty answer is all missing", async function () {
        await setSettings({ typeAnswers: true });
        await useNote(TYPED_NOTE);
        await openTypedCard();

        await browser.$(`${CARD} .fs-typed-input`).waitForDisplayed();
        await browser.$(`${CARD} .sr-show-answer-button`).click();
        await waitForBack();

        expect(await browser.$(`${CARD} .fs-typed-missing`).getProperty("textContent")).toBe(
            "Chief Audit Executive",
        );
        expect(await suggestedRating()).toBe("again");
    });

    it("cards are not typed while the setting is off", async function () {
        await useNote(TYPED_NOTE);
        await openTypedCard();
        await browser
            .$(`${CARD} .sr-show-answer-button`)
            .waitForClickable({ timeoutMsg: "no card was shown" });

        expect(await browser.$$(`${CARD} .fs-typed-input`).length).toBe(0);
        await browser.$(`${CARD} .sr-show-answer-button`).click();
        await waitForBack();
        expect(await suggestedRating()).toBeNull();
    });

    it("cloze blanks become fields when typing is on, and the answers are checked", async function () {
        await setSettings({ typeAnswers: true });
        await useNote(CLOZE_NOTE);
        await openTypedCard();

        // The card has two blanks; with the answers in order, both right suggests Good
        const inputs = await browser.$$(`${CARD} .cloze-input`);
        expect(inputs.length).toBe(1);
        await inputs[0].click();
        await inputs[0].setValue("Functionally");
        await browser.keys("Enter");
        await waitForBack();

        expect(await browser.$$(`${CARD} .cloze-answer-correct`).length).toBe(1);
        expect(await suggestedRating()).toBe("good");
    });

    it("the menu switches typing on for the session", async function () {
        await useNote(TYPED_NOTE);
        await openTypedCard();
        await browser
            .$(`${CARD} .sr-show-answer-button`)
            .waitForClickable({ timeoutMsg: "no card was shown" });
        expect(await browser.$$(`${CARD} .fs-typed-input`).length).toBe(0);

        // Obsidian's menus are native on a Mac, which the driver cannot click: ask for its own menus for this test
        const nativeMenus = await browser.executeObsidian(({ app }) => {
            const vault = app.vault as unknown as {
                getConfig(key: string): unknown;
                setConfig(key: string, value: unknown): void;
            };
            const before = vault.getConfig("nativeMenus");
            vault.setConfig("nativeMenus", false);
            return before;
        });
        try {
            // Open the card menu and pick "Type answers"
            await browser.$(`${CARD} .sr-extended-menu-button`).click();
            await browser.$(".menu").$("div*=Type answers").click();

            await browser.$(`${CARD} .fs-typed-input`).waitForDisplayed({
                timeoutMsg: "the field did not appear",
            });
        } finally {
            await browser.executeObsidian(({ app }, value) => {
                (
                    app.vault as unknown as { setConfig(key: string, value: unknown): void }
                ).setConfig("nativeMenus", value);
            }, nativeMenus);
        }
    });
});
