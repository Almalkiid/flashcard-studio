import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

import {
    NOTE,
    openReview,
    pluginId,
    readNote,
    SCHEDULE,
    setSettings,
    TAG,
    useNote,
    waitForPlugin,
} from "../card-syntax-helpers";

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

const PLAIN_CHOICE_NOTE = [
    TAG,
    "",
    "Which body should approve the internal audit charter?",
    "?",
    "- [ ] The chief audit executive",
    "- [x] The board",
    "",
].join("\n");

// A multiple choice card, then an ordinary one
const TWO_NOTE = [
    CHOICE_NOTE.trimEnd(),
    "",
    "What does CAE stand for?::Chief Audit Executive",
    "",
].join("\n");

// A card that is answered Again and comes back in a minute, then a typed one
const TYPED_AFTER_LEARNING_NOTE = [
    TAG,
    "",
    "What does CIA stand for?::Certified Internal Auditor",
    "",
    "What does CAE stand for?::Chief Audit Executive",
    "",
].join("\n");

// The same, with a multiple choice card second
const CHOICE_AFTER_LEARNING_NOTE = [
    TAG,
    "",
    "What does CIA stand for?::Certified Internal Auditor",
    "",
    "Which body should approve the internal audit charter?",
    "?",
    "- [ ] The chief audit executive",
    "- [x] The board",
    "- [ ] The external auditor",
    "",
].join("\n");

// Six options, for the key that AZERTY gives another character
const SIX_NOTE = [
    TAG,
    "",
    "Which of these is a line of defence?",
    "?",
    "- [ ] One",
    "- [ ] Two",
    "- [ ] Three",
    "- [ ] Four",
    "- [ ] Five",
    "- [x] Six",
    "",
].join("\n");

const RTL = ["---", "direction: rtl", "---", ""].join("\n");

// An option with an internal link: the note is in the fixture vault
const LINK_NOTE = [
    TAG,
    "",
    "Where are the cards?",
    "?",
    "- [ ] Nowhere",
    "- [x] In the [[Deck]] note",
    "",
].join("\n");

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
 * Waits until an element (the review screen, or a menu) has stopped moving. On the phone both slide up for a
 * quarter of a second, and a click made meanwhile lands where the element used to be.
 */
async function settle(selector = CARD): Promise<void> {
    let last = "";
    let unchanged = 0;
    await browser.waitUntil(
        async () => {
            const now = await browser.execute(
                (selector: string) =>
                    JSON.stringify(document.querySelector(selector)?.getBoundingClientRect()),
                selector,
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
async function openChoiceCard(tiles: number, command = "srs-review-flashcards"): Promise<void> {
    await browser.executeObsidianCommand(`${pluginId}:${command}`);
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

/** Replaces the device's speech with a recorder, so the tests can read what would have been said. */
async function recordSpeech(): Promise<void> {
    await browser.execute(() => {
        const w = window as unknown as { __spoken: string[]; speechSynthesis: SpeechSynthesis };
        w.__spoken = [];
        w.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
            w.__spoken.push(utterance.text);
        };
        w.speechSynthesis.cancel = () => undefined;
    });
}

async function spoken(): Promise<string[]> {
    return browser.execute(() => (window as unknown as { __spoken: string[] }).__spoken);
}

/**
 * Types the answer and presses Enter. On the desktop the field must already have focus, as it has on the first card of
 * a review: nothing here clicks it. A phone shows no keyboard on its own, so there the field is tapped first.
 */
async function typeAnswer(text: string): Promise<void> {
    const input = browser.$(`${CARD} .fs-typed-input`);
    await input.waitForDisplayed({ timeoutMsg: "no field to type the answer in" });
    if (await isMobile()) {
        // The card slides into place: a tap while it moves lands beside the field
        await settle(`${CARD} .fs-typed-input`);
        await input.click();
        await input.setValue(text);
    } else {
        await browser.keys(text);
        expect(await input.getValue()).toBe(text);
    }
    await browser.keys("Enter");
    await waitForBack();
}

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

/** Answering rewrites the note, and Obsidian indexes its tag again a moment later. */
async function waitForNoteTag(): Promise<void> {
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
        { timeoutMsg: "Obsidian never indexed the tag again" },
    );
}

/**
 * Picks an item from the card menu. Obsidian's menus are native on a Mac, which the driver cannot click, so the test
 * asks for its own menus while it does.
 */
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
        await browser.$(`${CARD} .sr-extended-menu-button`).click();
        await browser.$(".menu").waitForDisplayed({ timeoutMsg: "the menu did not open" });
        await settle(".menu");
        await browser.$(".menu").$(`div*=${title}`).click();
    } finally {
        await browser.executeObsidian(({ app }, value) => {
            (app.vault as unknown as VaultConfig).setConfig("nativeMenus", value);
        }, nativeMenus);
    }
}

/** Whether the star in the card's corner covers any part of an option tile. */
async function starCoversATile(): Promise<boolean> {
    return browser.execute((selector: string) => {
        const star = document.querySelector(`${selector} .fs-card-star`);
        if (!star) return false;
        const s = star.getBoundingClientRect();
        return Array.from(document.querySelectorAll(`${selector} .fs-choice`)).some((tile) => {
            const r = tile.getBoundingClientRect();
            return !(
                r.right <= s.left ||
                r.left >= s.right ||
                r.bottom <= s.top ||
                r.top >= s.bottom
            );
        });
    }, CARD);
}

/**
 * Whether these elements are all inside the card's visible part, and whether the ones in `begun` at least start
 * there (a long explanation may run on below).
 */
async function areInView(selectors: string[], begun: string[] = []): Promise<boolean> {
    return browser.execute(
        (card: string, whole: string[], started: string[]) => {
            const content = document.querySelector(`${card} .sr-content`);
            if (!content) return false;
            const c = content.getBoundingClientRect();
            const rect = (selector: string) =>
                document.querySelector(`${card} ${selector}`)?.getBoundingClientRect();
            return (
                whole.every((selector) => {
                    const r = rect(selector);
                    return r !== undefined && r.top >= c.top - 1 && r.bottom <= c.bottom + 1;
                }) &&
                started.every((selector) => {
                    const r = rect(selector);
                    return r !== undefined && r.top >= c.top - 1 && r.top < c.bottom;
                })
            );
        },
        CARD,
        selectors,
        begun,
    );
}

describe("multiple choice cards and typed answers", function () {
    before(waitForPlugin);

    beforeEach(async function () {
        await setTheme(false);
        await clearBuryList();
        await setSettings({
            dailyLimitsEnabled: false,
            flashcardCardOrder: "NewFirstSequential",
            flashcardTags: [TAG],
            shuffleChoices: false,
            typeAnswers: false,
            ignoreAccentsWhenTyping: false,
            readQuestionAloud: false,
            readAnswerAloud: false,
            reviewLook: "studio",
        });
    });

    afterEach(async function () {
        // Twice: the first may only close a menu that a failed test left open
        await browser.keys("Escape");
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
        // A small window scrolls to the answer: the chosen tile is in view, and the explanation starts there
        await browser.waitUntil(
            () => areInView([".fs-choice.is-correct"], [".fs-choice-explanation"]),
            { timeoutMsg: "the chosen tile and the start of the explanation are not in view" },
        );

        await screenshot("choice-back", false);
        await setTheme(true);
        await screenshot("choice-back", true);

        // The star in the card's corner covers no tile, wherever the card is scrolled to
        for (const fraction of [0, 0.5, 1]) {
            await browser.execute(
                (card: string, at: number) => {
                    const content = document.querySelector(`${card} .sr-content`) as HTMLElement;
                    content.scrollTop = (content.scrollHeight - content.clientHeight) * at;
                },
                CARD,
                fraction,
            );
            expect(await starCoversATile()).toBe(false);
        }
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
        // Your wrong tile and the right one stay in view, even where the whole card does not fit
        await browser.waitUntil(() => areInView([".fs-choice.is-wrong", ".fs-choice.is-correct"]), {
            timeoutMsg: "the wrong tile and the right one are not both in view",
        });

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
        if (await isMobile()) {
            await inputs[0].click();
            await inputs[0].setValue("Functionally");
        } else {
            // The first blank has focus already, on the first card of the review too
            await browser.keys("Functionally");
        }
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

        await pickFromCardMenu("Type answers");

        await browser.$(`${CARD} .fs-typed-input`).waitForDisplayed({
            timeoutMsg: "the field did not appear",
        });
    });

    it("the speaker button reads the side that is showing", async function () {
        await useNote(TYPED_NOTE);
        await recordSpeech();
        await openTypedCard();

        const speaker = browser.$(`${CARD} .fs-speak-button`);
        await speaker.waitForClickable({ timeoutMsg: "no speaker button" });
        await speaker.click();
        expect(await spoken()).toEqual(["What does CAE stand for?"]);

        await browser.$(`${CARD} .sr-show-answer-button`).click();
        await waitForBack();
        await speaker.click();
        // Only the answer, not the question again
        expect((await spoken()).slice(-1)).toEqual(["Chief Audit Executive."]);
    });

    it("reads the question and the answer by itself when asked", async function () {
        await setSettings({ readQuestionAloud: true, readAnswerAloud: true });
        await useNote(TYPED_NOTE);
        await recordSpeech();
        await openTypedCard();

        await browser.waitUntil(async () => (await spoken()).length === 1, {
            timeoutMsg: "the question was not read",
        });
        expect(await spoken()).toEqual(["What does CAE stand for?"]);

        await browser.$(`${CARD} .sr-show-answer-button`).click();
        await waitForBack();
        await browser.waitUntil(async () => (await spoken()).length === 2, {
            timeoutMsg: "the answer was not read",
        });
        expect(await spoken()).toEqual(["What does CAE stand for?", "Chief Audit Executive."]);
    });

    it("a multiple choice card reads its options, then the right answer and why", async function () {
        await useNote(CHOICE_NOTE);
        await recordSpeech();
        await openChoiceCard(4);

        const speaker = browser.$(`${CARD} .fs-speak-button`);
        await speaker.click();
        expect(await spoken()).toEqual([
            "Which body should approve the internal audit charter? The chief audit executive. The board. The external auditor. Senior management.",
        ]);

        await chooseOption(0);
        await waitForBack();
        await speaker.click();
        expect((await spoken()).slice(-1)).toEqual([
            "The board. Why. The board approves the charter; the CAE drafts it and senior management reviews it.",
        ]);
    });

    it("the R key reads the card on desktop", async function () {
        if (await isMobile()) this.skip();
        await useNote(TYPED_NOTE);
        await recordSpeech();
        await openTypedCard();

        await browser.keys("r");
        await browser.waitUntil(async () => (await spoken()).length === 1, {
            timeoutMsg: "the R key did not read the card",
        });
    });
    // MARK: Fix round 1

    it("the typed field has focus on the first card of a review, so shortcut keys are typed", async function () {
        if (await isMobile()) this.skip();
        await setSettings({ typeAnswers: true });
        await useNote(TYPED_NOTE);
        await openTypedCard();

        // Space, s, u, - , @ and the digits are review shortcuts: here they are letters of the answer
        await browser.keys("s u-@ 1");
        const input = browser.$(`${CARD} .fs-typed-input`);
        expect(await input.getValue()).toBe("s u-@ 1");
        expect(await input.isFocused()).toBe(true);
        // Nothing was revealed, skipped, undone or buried
        expect(await browser.$(`${CARD} .sr-show-answer-button`).isDisplayed()).toBe(true);
        expect(await browser.$(`${CARD} .sr-again-button`).isDisplayed()).toBe(false);
    });

    it("a letter typed while the field has no focus goes into the field, not to the shortcuts", async function () {
        if (await isMobile()) this.skip();
        await setSettings({ typeAnswers: true });
        await useNote(TYPED_NOTE);
        await openTypedCard();
        await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());

        await browser.keys("s");
        const input = browser.$(`${CARD} .fs-typed-input`);
        expect(await input.getValue()).toBe("s");
        expect(await input.isFocused()).toBe(true);
        expect(await browser.$(`${CARD} .sr-show-answer-button`).isDisplayed()).toBe(true);
    });

    it("reads a choice card's question with its options by itself, then the right answer and why", async function () {
        await setSettings({ readQuestionAloud: true, readAnswerAloud: true });
        await useNote(CHOICE_NOTE);
        await recordSpeech();
        await openChoiceCard(4);

        await browser.waitUntil(async () => (await spoken()).length === 1, {
            timeoutMsg: "the question was not read",
        });
        // With the options in it: they were rendered before the reading started
        expect(await spoken()).toEqual([
            "Which body should approve the internal audit charter? The chief audit executive. The board. The external auditor. Senior management.",
        ]);

        await chooseOption(1);
        await waitForBack();
        await browser.waitUntil(async () => (await spoken()).length === 2, {
            timeoutMsg: "the answer was not read",
        });
        expect((await spoken())[1]).toBe(
            "The board. Why. The board approves the charter; the CAE drafts it and senior management reviews it.",
        );
    });

    it("reads just the right answer when a choice card has no explanation", async function () {
        await setSettings({ readAnswerAloud: true });
        await useNote(PLAIN_CHOICE_NOTE);
        await recordSpeech();
        await openChoiceCard(2);

        await chooseOption(0);
        await waitForBack();
        await browser.waitUntil(async () => (await spoken()).length === 1, {
            timeoutMsg: "the answer was not read",
        });
        expect(await spoken()).toEqual(["The board."]);
    });

    it("Enter on a focused option chooses that option", async function () {
        if (await isMobile()) this.skip();
        await useNote(CHOICE_NOTE);
        await openChoiceCard(4);

        await browser.execute(
            (selector: string) => (document.querySelector(selector) as HTMLElement).focus(),
            `${CARD} .fs-choice[data-option="1"]`,
        );
        await browser.keys("Enter");
        await waitForBack();

        expect(await browser.$(`${CARD} .fs-choice.is-correct`).getAttribute("class")).toContain(
            "is-picked",
        );
        expect(await suggestedRating()).toBe("good");
    });

    it("Space on a focused option toggles it once in a several-answer question, and after a click Space checks", async function () {
        if (await isMobile()) this.skip();
        await useNote(MULTI_NOTE);
        await openChoiceCard(3);
        const selected = () => browser.$$(`${CARD} .fs-choice.is-selected`).length;

        await browser.execute(
            (selector: string) => (document.querySelector(selector) as HTMLElement).focus(),
            `${CARD} .fs-choice[data-option="0"]`,
        );
        await browser.keys("Space");
        expect(await selected()).toBe(1);
        expect(await browser.$(`${CARD} .fs-choice-check`).isEnabled()).toBe(true);
        await browser.keys("Space");
        expect(await selected()).toBe(0);

        // A click leaves no focus on the tile, so Space then shows the answer with what was chosen
        await chooseOption(1);
        expect(await selected()).toBe(1);
        await browser.keys("Space");
        await waitForBack();
        expect(await browser.$$(`${CARD} .fs-choice.is-picked`).length).toBe(1);
    });

    it("a number key rates after a number key chose", async function () {
        if (await isMobile()) this.skip();
        await setSettings({ answerKeys: "anki" });
        try {
            await useNote(CHOICE_NOTE);
            await openChoiceCard(4);
            await browser.keys("2");
            await waitForBack();
            // 4 is Easy: a new card answered Good comes back within the learn ahead limit
            await browser.keys("4");
            // The only card is answered: the session is over
            await browser.waitUntil(
                async () =>
                    ((await browser.$(CARD).getAttribute("class")) ?? "").includes(
                        "sr-summary-open",
                    ),
                { timeoutMsg: "the number key did not rate the card" },
            );
            expect(readNote()).toMatch(new RegExp(SCHEDULE));
        } finally {
            await setSettings({ answerKeys: "original" });
        }
    });

    it("a right-to-left note reads right to left in the options and the typed result", async function () {
        await useNote(RTL + CHOICE_NOTE);
        await openChoiceCard(4);
        expect(await browser.$(`${CARD} .fs-choice-root`).getAttribute("dir")).toBe("rtl");
        expect(await browser.$(`${CARD} .fs-choices`).getAttribute("dir")).toBe("rtl");
        await chooseOption(1);
        await waitForBack();
        expect(await browser.$(`${CARD} .fs-choices`).getAttribute("dir")).toBe("rtl");
        await browser.keys("Escape");

        await setSettings({ typeAnswers: true });
        await useNote(RTL + TYPED_NOTE);
        await openTypedCard();
        expect(await browser.$(`${CARD} .fs-typed`).getAttribute("dir")).toBe("rtl");
        await typeAnswer("chief");
        expect(await browser.$(`${CARD} .fs-typed-result`).getAttribute("dir")).toBe("rtl");
    });

    it("an internal link in an option opens its note and does not choose the option", async function () {
        await useNote(LINK_NOTE);
        await openChoiceCard(2);

        await browser.$(`${CARD} .fs-choice-text a.internal-link`).click();
        await browser.pause(400);

        // Still asking: the tiles are buttons, and none was chosen
        expect(await browser.$$(`${CARD} button.fs-choice`).length).toBe(2);
        expect(await browser.$$(`${CARD} .fs-choice.is-selected`).length).toBe(0);
    });

    it("undo after answering a choice card brings back its front with nothing chosen or suggested", async function () {
        await useNote(TWO_NOTE);
        await openChoiceCard(4);
        await chooseOption(1);
        await waitForBack();
        await browser.$(`${CARD} .sr-easy-button`).click();
        // The next card is the ordinary one
        await browser
            .$(`${CARD} .sr-show-answer-button`)
            .waitForClickable({ timeoutMsg: "the next card did not show" });
        await browser.$(`${CARD} .sr-answer-toast-undo`).click();

        await browser.waitUntil(
            async () => (await browser.$$(`${CARD} button.fs-choice`).length) === 4,
            {
                timeoutMsg: "the choice card did not come back",
            },
        );
        await browser.waitUntil(async () => (await tileTexts()).every((text) => text.length > 0));
        expect(await browser.$$(`${CARD} .fs-choice.is-selected`).length).toBe(0);
        expect(await browser.$$(`${CARD} .fs-choice.is-result`).length).toBe(0);
        expect(await browser.$$(`${CARD} .fs-suggested`).length).toBe(0);
        expect(await browser.$(`${CARD} .sr-again-button`).isDisplayed()).toBe(false);
        expect(await browser.$(`${CARD} .sr-show-answer-button`).isDisplayed()).toBe(false);

        // and it can be answered again, differently
        await settle();
        await chooseOption(0);
        await waitForBack();
        expect(await suggestedRating()).toBe("again");
    });

    it("skipping a choice card that has been answered gives the next card no choice and no suggestion", async function () {
        await useNote(TWO_NOTE);
        await openChoiceCard(4);
        await chooseOption(0);
        await waitForBack();
        expect(await suggestedRating()).toBe("again");

        await pickFromCardMenu("Skip");

        await browser
            .$(`${CARD} .sr-show-answer-button`)
            .waitForClickable({ timeoutMsg: "the next card did not show" });
        expect(await browser.$$(`${CARD} .fs-choice`).length).toBe(0);
        expect(await browser.$$(`${CARD} .fs-suggested`).length).toBe(0);
        expect(await browser.$(`${CARD} .sr-again-button`).isDisplayed()).toBe(false);
    });

    it("a choice card with a schedule keeps its options, and in cram only Again and Easy are suggested", async function () {
        await useNote(CHOICE_NOTE);
        await openChoiceCard(4);
        await chooseOption(1);
        await waitForBack();
        await browser.$(`${CARD} .sr-easy-button`).click();
        // The schedule is written after the checklist and its explanation
        await browser.waitUntil(() => new RegExp(SCHEDULE).test(readNote()), {
            timeoutMsg: "the schedule was never written",
        });
        expect(readNote()).toContain("- [x] The board");
        await browser.keys("Escape");
        await waitForNoteTag();

        await openChoiceCard(4, "srs-cram-flashcards");
        // The schedule comment is in no option
        expect(await tileTexts()).toEqual([
            "The chief audit executive",
            "The board",
            "The external auditor",
            "Senior management",
        ]);
        await chooseOption(1);
        await waitForBack();
        expect(await suggestedRating()).toBe("easy");
        expect(await browser.$(`${CARD} .sr-good-button`).isDisplayed()).toBe(false);
        expect(
            await browser.$(`${CARD} .fs-choice-explanation-text`).getProperty("textContent"),
        ).toBe(
            "Why. The board approves the charter; the CAE drafts it and senior management reviews it.",
        );
        await browser.keys("Escape");

        await openChoiceCard(4, "srs-cram-flashcards");
        await chooseOption(0);
        await waitForBack();
        expect(await suggestedRating()).toBe("again");
    });
    // MARK: Final review

    /** Sends a key press to the page as a keyboard with any layout would: what the key gives, and where it is. */
    async function pressKey(init: { key: string; code: string }): Promise<void> {
        await browser.execute((key: { key: string; code: string }) => {
            const target = document.activeElement ?? document.body;
            target.dispatchEvent(
                new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }),
            );
        }, init);
    }

    async function waitForWaitingScreen(): Promise<void> {
        await browser
            .$(`${CARD} .sr-centered`)
            .waitForDisplayed({ timeoutMsg: "the waiting screen was not shown" });
        expect(await browser.$(`${CARD} .sr-centered`).getText()).toContain("Waiting");
    }

    it("skipping a typed card into the waiting screen leaves no field behind: U undoes the answer that was given", async function () {
        if (await isMobile()) this.skip();
        // Nothing may come back within the minute, so that skipping the second card leaves only the waiting screen
        await setSettings({ typeAnswers: true, learnAheadMinutes: 0 });
        await useNote(TYPED_AFTER_LEARNING_NOTE);
        await openTypedCard();
        await typeAnswer("nothing like it");
        // Again: the card is learning, due in a minute
        await browser.$(`${CARD} .sr-again-button`).click();

        // The second card is typed: it has its field
        await browser
            .$(`${CARD} .fs-typed-input`)
            .waitForDisplayed({ timeoutMsg: "the second card has no field" });
        await settle();
        await pickFromCardMenu("Skip");
        await waitForWaitingScreen();
        expect(await browser.$(`${CARD} .fs-typed-input`).isExisting()).toBe(false);

        // A digit is nobody's, and the screen stays as it is
        await browser.keys("1");
        await browser.pause(300);
        expect(await browser.$(`${CARD} .sr-centered`).isDisplayed()).toBe(true);
        expect(await browser.$(`${CARD} .sr-again-button`).isDisplayed()).toBe(false);

        // U is undo again: the answer to the first card is taken back, and it comes up with its field
        await browser.keys("u");
        await browser
            .$(`${CARD} .fs-typed-input`)
            .waitForDisplayed({ timeoutMsg: "U did not undo the answer on the waiting screen" });
        expect(await browser.$(`${CARD} .sr-centered`).isExisting()).toBe(false);
    });

    it("skipping a multiple choice card into the waiting screen leaves no tiles for a digit to press", async function () {
        if (await isMobile()) this.skip();
        await setSettings({ learnAheadMinutes: 0 });
        await useNote(CHOICE_AFTER_LEARNING_NOTE);
        await openReview();
        await browser
            .$(`${CARD} .sr-show-answer-button`)
            .waitForClickable({ timeoutMsg: "no card was shown" });
        await settle();
        await browser.$(`${CARD} .sr-show-answer-button`).click();
        await waitForBack();
        await browser.$(`${CARD} .sr-again-button`).click();

        await browser
            .$(`${CARD} .fs-choice`)
            .waitForDisplayed({ timeoutMsg: "the choice card did not show" });
        await settle();
        await pickFromCardMenu("Skip");
        await waitForWaitingScreen();
        expect(await browser.$$(`${CARD} .fs-choice`).length).toBe(0);

        // A digit chose an option of the card that had gone, and showed its answer; now it does nothing
        await browser.keys("2");
        await browser.pause(300);
        expect(await browser.$(`${CARD} .sr-centered`).isDisplayed()).toBe(true);
        expect(await browser.$(`${CARD} .sr-again-button`).isDisplayed()).toBe(false);
        expect(await browser.$(`${CARD} .sr-content`).getAttribute("class")).not.toContain(
            "fs-choice-card",
        );
    });

    it("on AZERTY the 6 key chooses option 6, and does not bury the card", async function () {
        if (await isMobile()) this.skip();
        await useNote(SIX_NOTE);
        await openChoiceCard(6);

        // The key that is 6 on AZERTY gives "-", which buries when it comes from a key that is not a number
        await pressKey({ key: "-", code: "Digit6" });
        await waitForBack();
        expect(await browser.$(`${CARD} .fs-choice.is-picked`).getAttribute("data-option")).toBe(
            "5",
        );
        expect(await suggestedRating()).toBe("good");
        // Burying writes the card's schedule, with the day it is buried until, into the note: nothing was written
        expect(readNote()).not.toMatch(new RegExp(SCHEDULE));
    });

    it("the minus key still buries", async function () {
        if (await isMobile()) this.skip();
        await useNote(SIX_NOTE);
        await openChoiceCard(6);

        await pressKey({ key: "-", code: "Minus" });
        await browser.waitUntil(() => new RegExp(SCHEDULE).test(readNote()), {
            timeoutMsg: "the minus key did not bury the card",
        });
        expect(await browser.$$(`${CARD} .fs-choice.is-picked`).length).toBe(0);
    });
});
