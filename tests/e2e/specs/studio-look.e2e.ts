import { browser, expect } from "@wdio/globals";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import { obsidianPage } from "wdio-obsidian-service";

import {
    answerEasy,
    openReview,
    pluginId,
    setSettings,
    TAG,
    useNote,
    waitForPlugin,
} from "../card-syntax-helpers";

// The Studio look of the review screen (issue #11): a cloze reads the same before and after its answer shows, and
// the page and the card take their colours from the Obsidian theme.
// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.

const CARD = ".fs-view .fs-card-container";

const CLOZE_ONE =
    "The chief audit executive reports functionally to the ==board== and administratively to a level " +
    "of the organisation that lets the internal audit function fulfil its responsibilities, which protects " +
    "the independence of the function and the objectivity of every engagement it performs.";
const CLOZE_TWO =
    "Internal auditing strengthens the organisation's ability to create, protect and sustain value by " +
    "giving the board and management independent, risk-based and ==objective== assurance, advice, insight " +
    "and foresight across governance, risk management and control.";

// A cloze, an ordinary card, a cloze again; the last one answered Again leaves nothing due, which is the waiting screen
const MIXED_NOTE = [
    TAG,
    "",
    CLOZE_ONE,
    "",
    "Who owns and manages risk?::Management",
    "",
    CLOZE_TWO,
    "",
].join("\n");

const ARABIC_NOTE = [
    "---",
    "direction: rtl",
    "---",
    TAG,
    "",
    "يجب أن يرفع الرئيس التنفيذي للتدقيق الداخلي تقاريره وظيفيا إلى ==مجلس الإدارة== وإداريا إلى مستوى " +
        "داخل المؤسسة يمكّن نشاط التدقيق الداخلي من أداء مسؤولياته، وهو ما يحمي استقلالية النشاط " +
        "وموضوعية كل مهمة يقوم بها المدققون الداخليون في جميع أعمالهم.",
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

/** How the first block of the card reads, and where it is. */
interface Reading {
    fontSize: string;
    lineHeight: string;
    fontWeight: string;
    textAlign: string;
    letterSpacing: string;
    direction: string;
    left: number;
    top: number;
    width: number;
    /** From the block's left edge to the first line's, and from the first line's right edge to the block's. */
    firstLineLeftGap: number;
    firstLineRightGap: number;
}

interface CardState {
    classes: string;
    lines: number;
    first: Reading;
    /** The block after the "Answer" label, when the label is in the card. */
    answer: Reading | null;
    /** Whether the "Answer" label is in the card, and takes up room. */
    labelShown: boolean;
    animation: string;
}

async function cardState(): Promise<CardState> {
    return browser.execute((card: string) => {
        const content = document.querySelector<HTMLElement>(`${card} .fs-content`);
        if (content === null) throw new Error("no card content");
        const read = (el: HTMLElement) => {
            const style = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(el);
            const firstLine = range.getClientRects()[0];
            return {
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                fontWeight: style.fontWeight,
                textAlign: style.textAlign,
                letterSpacing: style.letterSpacing,
                direction: style.direction,
                left: Math.round(box.left),
                top: Math.round(box.top),
                width: Math.round(box.width),
                firstLineLeftGap: Math.round(firstLine.left - box.left),
                firstLineRightGap: Math.round(box.right - firstLine.right),
            };
        };
        const blocks = Array.from(content.children).filter(
            (el): el is HTMLElement =>
                el.instanceOf(HTMLElement) &&
                !el.matches(".fs-context, .fs-reveal-hint, .fs-answer-pill, hr"),
        );
        const label = content.querySelector<HTMLElement>(":scope > .fs-answer-pill");
        const afterLabel = label?.nextElementSibling;
        const first = blocks[0];
        return {
            classes: content.className,
            lines: Math.round(
                first.getBoundingClientRect().height /
                    parseFloat(getComputedStyle(first).lineHeight),
            ),
            first: read(first),
            answer: afterLabel instanceof HTMLElement ? read(afterLabel) : null,
            labelShown: label !== null && label.getBoundingClientRect().height > 0,
            animation: getComputedStyle(first).animationName,
        };
    }, CARD);
}

async function waitForFront(): Promise<void> {
    await browser
        .$(`${CARD} .fs-show-answer-button`)
        .waitForClickable({ timeoutMsg: "no card front was shown" });
    // The card slides into place
    await browser.pause(450);
}

async function reveal(): Promise<void> {
    await browser.$(`${CARD} .fs-show-answer-button`).click();
    await browser
        .$(`${CARD} .fs-easy-button`)
        .waitForClickable({ timeoutMsg: "the answer buttons were not shown" });
    // An ordinary answer fades in
    await browser.pause(450);
}

/** A cloze on screen: the same before and after its answer shows. */
async function expectStableCloze(): Promise<{ front: CardState; back: CardState }> {
    const front = await cardState();
    expect(front.classes).toContain("fs-cloze-card");
    expect(front.lines).toBeGreaterThan(1);
    await reveal();
    const back = await cardState();
    expect(back.classes).toContain("fs-cloze-card");
    expect(back.classes).toContain("fs-answer-shown");
    expect(back.first).toEqual(front.first);
    expect(back.first.fontSize).toBe("18px");
    expect(back.first.textAlign).toBe("start");
    expect(back.labelShown).toBe(false);
    expect(back.animation).toBe("none");
    return { front, back };
}

interface Colours {
    page: string;
    pageImage: string;
    card: string;
    themePage: string;
    themeCard: string;
    accent: string;
}

/** What the review page and the card are painted with, next to what the theme asks for. */
async function colours(): Promise<Colours> {
    return browser.execute((card: string) => {
        const root = document.querySelector<HTMLElement>(card);
        const content = document.querySelector<HTMLElement>(`${card} .fs-content`);
        if (root === null || content === null) throw new Error("no review screen");
        const resolved = (variable: string): string => {
            const probe = document.body.createDiv();
            probe.style.backgroundColor = `var(${variable})`;
            const colour = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return colour;
        };
        return {
            page: getComputedStyle(root).backgroundColor,
            pageImage: getComputedStyle(root).backgroundImage,
            card: getComputedStyle(content).backgroundColor,
            themePage: resolved("--background-primary"),
            themeCard: resolved("--background-primary-alt"),
            accent: getComputedStyle(root).getPropertyValue("--fs-accent").trim(),
        };
    }, CARD);
}

async function setTheme(light: boolean): Promise<void> {
    await browser.execute((useLight: boolean) => {
        document.body.classList.toggle("theme-light", useLight);
        document.body.classList.toggle("theme-dark", !useLight);
    }, light);
    await browser.pause(200);
}

describe("the Studio look of the review screen", function () {
    let startedLight = true;

    before(async function () {
        await waitForPlugin();
        startedLight = await browser.execute(() => document.body.classList.contains("theme-light"));
    });

    // Only the note of the test is a deck, its cards come in the order they are written, and none is held back
    beforeEach(async function () {
        await clearBuryList();
        await setSettings({
            reviewLook: "studio",
            dailyLimitsEnabled: false,
            flashcardCardOrder: "NewFirstSequential",
            flashcardTags: [TAG],
            learnAheadMinutes: 0,
        });
    });

    // A test that fails leaves its review open, which the next one must not find
    afterEach(async function () {
        await browser.keys("Escape");
        await browser.pause(300);
    });

    after(async function () {
        await browser.execute(() => {
            document.body.style.removeProperty("--background-primary");
            document.body.style.removeProperty("--background-primary-alt");
        });
        await setTheme(startedLight);
        await setSettings({
            flashcardTags: ["#flashcards"],
            dailyLimitsEnabled: true,
            learnAheadMinutes: 20,
        });
        await obsidianPage.resetVault();
    });

    it("a cloze reads the same on both sides, an ordinary card keeps its own look, and the waiting screen is neither", async function () {
        await useNote(MIXED_NOTE);
        await openReview();

        // Cloze
        await waitForFront();
        const one = await expectStableCloze();
        expect(one.back.first.firstLineLeftGap).toBe(0);
        await answerEasy();

        // Ordinary card: a large centred question, then the "Answer" label over the answer
        await waitForFront();
        const front = await cardState();
        expect(front.classes).not.toContain("fs-cloze-card");
        expect(front.first.fontSize).toBe("24px");
        expect(front.first.textAlign).toBe("center");
        await reveal();
        const back = await cardState();
        expect(back.classes).not.toContain("fs-cloze-card");
        expect(back.labelShown).toBe(true);
        expect(back.first.fontSize).toBe("15px");
        expect(back.answer?.fontSize).toBe("18px");
        await answerEasy();

        // Cloze again: the ordinary card in between left nothing behind
        await waitForFront();
        const two = await expectStableCloze();
        expect(two.front.first.left).toBe(one.front.first.left);
        expect(two.front.first.top).toBe(one.front.first.top);

        // Again: the card is due in a minute and nothing else is, so the screen waits
        await browser.$(`${CARD} .fs-again-button`).click();
        await browser
            .$(`${CARD} .fs-centered`)
            .waitForDisplayed({ timeoutMsg: "no waiting screen" });
        const waiting = await browser.$(`${CARD} .fs-content`).getAttribute("class");
        expect(waiting).not.toContain("fs-cloze-card");
        expect(waiting).not.toContain("fs-answer-shown");
    });

    it("a long right-to-left cloze starts at the right edge on both sides", async function () {
        await useNote(ARABIC_NOTE);
        await openReview();
        await waitForFront();
        const { front, back } = await expectStableCloze();
        expect(front.first.direction).toBe("rtl");
        expect(front.first.firstLineRightGap).toBe(0);
        expect(back.first.firstLineRightGap).toBe(0);
    });

    it("the page and the card follow the Obsidian theme, also when it changes while a card is open", async function () {
        await useNote(MIXED_NOTE);
        await openReview();
        await waitForFront();

        await setTheme(true);
        const light = await colours();
        expect(light.page).toBe(light.themePage);
        expect(light.card).toBe(light.themeCard);
        expect(light.pageImage).toBe("none");
        expect(light.accent).toBe("#2563eb");

        await setTheme(false);
        const dark = await colours();
        expect(dark.page).toBe(dark.themePage);
        expect(dark.card).toBe(dark.themeCard);
        expect(dark.pageImage).toBe("none");
        expect(dark.accent).toBe("#4f8cff");
        expect(dark.page).not.toBe(light.page);

        // A theme of its own: colours no default theme has
        await browser.execute(() => {
            document.body.setCssProps({
                "--background-primary": "rgb(40, 20, 60)",
                "--background-primary-alt": "rgb(60, 30, 90)",
            });
        });
        await browser.pause(200);
        const custom = await colours();
        expect(custom.page).toBe("rgb(40, 20, 60)");
        expect(custom.card).toBe("rgb(60, 30, 90)");
        expect(custom.accent).toBe("#4f8cff");
    });
});
