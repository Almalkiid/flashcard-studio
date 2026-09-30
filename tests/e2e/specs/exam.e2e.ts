import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

import { pluginId, setSettings, TAG, useNote, waitForPlugin } from "../card-syntax-helpers";

// Exams: the setup, the exam (question, map, timer, keys), the results, the file they leave in the vault, and
// "Study the ones I missed". Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.
// Set SCREENSHOTS=1 to save screenshots; SCREENSHOT_DIR points them somewhere else than docs/media/screenshots.

const SCREENSHOT_DIR = path.resolve(process.env.SCREENSHOT_DIR ?? "docs/media/screenshots");
const takeScreenshots = process.env.SCREENSHOTS === "1";

const EXAM_VIEW = "flashcard-studio-exam";
const TAB_VIEW = "spaced-repetition-tab-view";
const SHELL = ".fs-desktop-shell";
const BODY = ".fs-exam .fs-exam-question-body:not(.is-pending)";
const TILE = `${BODY} .fs-choice`;
const EXAMS_FOLDER = "Flashcard Studio/Exams";

interface Question {
    front: string;
    options: string[];
    right: number;
    wrong: number;
}

// Three multiple choice cards, so an exam of two has one that is left out
const QUESTIONS: Question[] = [
    {
        front: "Which body approves the internal audit charter?",
        options: ["The chief audit executive", "The board", "The external auditor"],
        right: 1,
        wrong: 0,
    },
    {
        front: "Which line of defence is internal audit?",
        options: ["The first", "The second", "The third"],
        right: 2,
        wrong: 0,
    },
    {
        front: "What does CAE stand for?",
        options: ["Chief audit executive", "Chief accounting expert", "Central audit entity"],
        right: 0,
        wrong: 1,
    },
];

const CHOICE_NOTE = [
    TAG,
    "",
    ...QUESTIONS.flatMap((q) => [
        q.front,
        "?",
        ...q.options.map((text, index) => `- [${index === q.right ? "x" : " "}] ${text}`),
        "Why. It is what the Standards say.",
        "",
    ]),
].join("\n");

// A multiple choice card, a short typed one and a long one that is marked by the person
const MIXED_NOTE = [
    TAG,
    "",
    QUESTIONS[0].front,
    "?",
    ...QUESTIONS[0].options.map((text, index) => `- [${index === 1 ? "x" : " "}] ${text}`),
    "",
    "What does CAE stand for?::Chief Audit Executive",
    "",
    "Explain independence",
    "?",
    "Freedom from conditions that threaten objectivity.",
    "It applies to the function and to each auditor.",
    "",
].join("\n");

// 130 multiple choice cards, some with a short question and some with a long one, to sit the CIA simulation with
const LONG_TEXT =
    "An internal auditor is planning an engagement over the treasury function of a multinational group. The chief " +
    "audit executive has asked for the objectives to reflect the risks identified in the annual risk assessment, and " +
    "management has asked that the scope leave out the group's newest subsidiary, which was acquired last quarter.";

function bigNote(): string {
    const cards: string[] = [];
    for (let n = 1; n <= 130; n++) {
        const long = n % 3 === 0;
        cards.push(
            long
                ? `Question ${n}. ${LONG_TEXT} Which of the following should the internal auditor do first, and why?`
                : `Question ${n}. Who approves the charter?`,
            "?",
            `- [ ] ${long ? "Ask the audit committee to approve the omission of the subsidiary from the scope, and record its decision" : "The CAE"}`,
            "- [x] The board",
            `- [ ] ${long ? "Include the subsidiary in the scope without telling management, because independence forbids any restriction" : "Management"}`,
            "- [ ] The external auditor",
            "",
        );
    }
    return [TAG, "", ...cards].join("\n");
}

async function isMobile(): Promise<boolean> {
    return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

async function setTheme(light: boolean): Promise<void> {
    await browser.execute((useLight: boolean) => {
        document.body.classList.toggle("theme-light", useLight);
        document.body.classList.toggle("theme-dark", !useLight);
    }, light);
    await browser.pause(200);
}

/** Saves `<name>-<dark|light>-<desktop|mobile>.png` (dark has no theme in its name, like the other screenshots). */
async function screenshot(name: string, light: boolean): Promise<void> {
    if (!takeScreenshots) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await browser.execute(() => {
        document.querySelectorAll(".notice").forEach((notice) => notice.remove());
    });
    await browser.pause(450);
    await browser.saveScreenshot(
        path.join(
            SCREENSHOT_DIR,
            `${name}${light ? "-light" : ""}-${(await isMobile()) ? "mobile" : "desktop"}.png`,
        ),
    );
}

/** Waits until an element has stopped moving: on the phone the dialogs and the sheet slide in for a moment. */
async function settle(selector: string): Promise<void> {
    let last = "";
    let unchanged = 0;
    await browser.waitUntil(
        async () => {
            const now = await browser.execute(
                (css: string) =>
                    JSON.stringify(document.querySelector(css)?.getBoundingClientRect()),
                selector,
            );
            unchanged = now === last ? unchanged + 1 : 0;
            last = now;
            return unchanged >= 3;
        },
        { interval: 80, timeoutMsg: `${selector} never stopped moving` },
    );
}

async function resizeWindow(width: number, height: number): Promise<void> {
    await browser.executeObsidian(
        (_context, w, h) => {
            const remote = (
                window as unknown as {
                    require: (id: string) => {
                        getCurrentWindow: () => { setSize: (w: number, h: number) => void };
                    };
                }
            ).require("@electron/remote");
            remote.getCurrentWindow().setSize(w, h);
        },
        width,
        height,
    );
    await browser.pause(400);
}

/** Gives the tab the whole window, so the pane is wide enough for the desktop layout. */
async function useFullWindow(): Promise<void> {
    await resizeWindow(1440, 900);
    await browser.executeObsidian(({ app }) => {
        app.workspace.leftSplit.collapse();
        app.workspace.rightSplit.collapse();
    });
    await browser.pause(300);
}

function examFiles(): string[] {
    const dir = path.join(obsidianPage.getVaultPath(), EXAMS_FOLDER);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".md")) : [];
}

/** Opens the Studio as a tab with the desktop shell, as a new install on the desktop has it. */
async function useShell(): Promise<void> {
    await setSettings({
        openViewInNewTab: true,
        flashcardWidthPercentage: 100,
        flashcardHeightPercentage: 100,
    });
    await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
}

async function closeEverything(): Promise<void> {
    await browser.executeObsidian(
        ({ app }, examType, tabType) => {
            app.workspace.detachLeavesOfType(examType);
            app.workspace.detachLeavesOfType(tabType);
        },
        EXAM_VIEW,
        TAB_VIEW,
    );
    await browser.keys("Escape");
    await browser.keys("Escape");
}

// #region -> Setup

async function openSetup(): Promise<void> {
    await browser.executeObsidianCommand(`${pluginId}:fs-take-exam`);
    await browser
        .$(".fs-exam-modal .fs-exam-presets")
        .waitForDisplayed({ timeoutMsg: "the exam setup was not shown" });
    await settle(".fs-exam-modal");
}

/** Types a number into a field of the setup, as a person who selects the old one and types over it does. */
async function setNumber(id: string, value: number): Promise<void> {
    await browser.execute(
        (css: string, text: string) => {
            const input = document.querySelector<HTMLInputElement>(css);
            if (input === null) throw new Error(`no field ${css}`);
            input.focus();
            input.value = text;
            // The change event comes when the field loses focus
            input.dispatchEvent(new Event("change", { bubbles: true }));
        },
        `#${id}`,
        String(value),
    );
}

async function chooseCards(filter: "choice-only" | "all"): Promise<void> {
    await browser.$(`.fs-exam-options input[value="${filter}"]`).click();
}

async function pressStart(): Promise<void> {
    const start = browser.$(".fs-exam-start");
    await start.waitForClickable({ timeoutMsg: "Start was not available" });
    await start.click();
    await browser.$(BODY).waitForDisplayed({ timeoutMsg: "the exam did not open" });
    await waitForQuestion();
}

/** Opens the setup, asks for `count` questions of the note, and starts. */
async function startExam(
    count: number,
    options: { minutes?: number | null; cards?: "choice-only" | "all" } = {},
): Promise<void> {
    await openSetup();
    await setNumber("fs-exam-count", count);
    if (options.cards !== undefined) await chooseCards(options.cards);
    if (options.minutes !== undefined && options.minutes !== null) {
        await browser.$(".fs-exam-chip").click();
        await setNumber("fs-exam-minutes", options.minutes);
    }
    await pressStart();
}

// #endregion

// #region -> The exam

/** Waits until the question on screen is drawn: its text, and the options or the field. */
async function waitForQuestion(): Promise<void> {
    await browser.waitUntil(
        async () =>
            browser.execute((css: string) => {
                const body = document.querySelector(css);
                if (body === null) return false;
                const question = body.querySelector(".fs-exam-question");
                if ((question?.textContent ?? "").trim() === "") return false;
                const tiles = Array.from(body.querySelectorAll(".fs-choice-text"));
                return tiles.every((tile) => (tile.textContent ?? "").trim() !== "");
            }, BODY),
        { timeoutMsg: "the question was never drawn" },
    );
}

async function questionText(): Promise<string> {
    return browser.execute(
        (css: string) =>
            document.querySelector(`${css} .fs-exam-question`)?.textContent?.trim() ?? "",
        BODY,
    );
}

async function counter(): Promise<string> {
    return browser.execute(
        () => document.querySelector(".fs-exam .fs-exam-counter")?.textContent?.trim() ?? "",
    );
}

function known(front: string): Question {
    const question = QUESTIONS.find((candidate) => front.startsWith(candidate.front));
    if (question === undefined) throw new Error(`an unexpected question: ${front}`);
    return question;
}

/** Chooses the right option of the question on screen, or a wrong one. */
async function answerCurrent(right: boolean): Promise<Question> {
    const question = known(await questionText());
    await browser.$(`${TILE}[data-option="${right ? question.right : question.wrong}"]`).click();
    return question;
}

/** Waits until another question than `before` is on screen, drawn. */
async function waitForOtherQuestion(before: string): Promise<void> {
    await browser.waitUntil(async () => (await questionText()) !== before, {
        timeoutMsg: "the question on screen did not change",
    });
    await waitForQuestion();
}

async function goNext(): Promise<void> {
    const before = await questionText();
    await browser.$(".fs-exam-next").click();
    await waitForOtherQuestion(before);
}

/** Submits from the last question: its Next button says Submit, and the dialog asks. */
async function submitFromLast(): Promise<void> {
    await browser.$(".fs-exam-next").click();
    const dialog = browser.$(".fs-exam-dialog");
    await dialog.waitForDisplayed({ timeoutMsg: "the submit dialog was not shown" });
    await settle(".fs-exam-dialog");
    await browser.$(".fs-exam-dialog .fs-primary-button").click();
    await browser.$(".fs-exam-ring-value").waitForDisplayed({ timeoutMsg: "no results" });
}

async function resultPercent(): Promise<string> {
    return browser.$(".fs-exam-ring-value").getText();
}

/** The results file, once it has been written: its name and its text. */
async function waitForExamFile(previous = 0): Promise<{ name: string; text: string }> {
    await browser.waitUntil(() => examFiles().length > previous, {
        timeoutMsg: "the results file was never written",
    });
    const name = examFiles().sort().reverse()[0];
    return {
        name,
        text: fs.readFileSync(path.join(obsidianPage.getVaultPath(), EXAMS_FOLDER, name), "utf8"),
    };
}

// #endregion

describe("exams", function () {
    before(async function () {
        await waitForPlugin();
    });

    beforeEach(async function () {
        await useNote(CHOICE_NOTE);
        await setSettings({
            // The note of the spec is the only deck, so the fixture deck is not part of an exam
            flashcardTags: [TAG],
            reviewLook: "studio",
            dailyLimitsEnabled: false,
            examPassPercent: 75,
            shuffleChoices: true,
            ignoreAccentsWhenTyping: false,
            // As the other specs have them: the Studio in a modal
            openViewInNewTab: false,
            flashcardWidthPercentage: 60,
            flashcardHeightPercentage: 60,
        });
        if (!(await isMobile())) {
            await useFullWindow();
            await setTheme(true);
        }
        // Earlier tests leave their exams in the vault folder; the vault reset does not know about them
        for (const name of examFiles()) {
            fs.rmSync(path.join(obsidianPage.getVaultPath(), EXAMS_FOLDER, name));
        }
    });

    afterEach(async function () {
        await browser.execute(() => {
            const w = window as unknown as {
                __realNow?: () => number;
                __realRandom?: () => number;
            };
            if (w.__realNow !== undefined) Date.now = w.__realNow;
            delete w.__realNow;
            if (w.__realRandom !== undefined) Math.random = w.__realRandom;
            delete w.__realRandom;
        });
        await closeEverything();
    });

    after(async function () {
        await setSettings({ flashcardTags: ["#flashcards"] });
        if (!(await isMobile())) await resizeWindow(1280, 800);
    });

    it("the setup offers the presets and the decks, and Start opens the exam", async function () {
        await openSetup();
        const presets = await browser.$$(".fs-exam-preset");
        expect(presets).toHaveLength(2);
        expect(await presets[0].getText()).toContain("Quick check");
        expect(await presets[0].getText()).toContain("20 questions, no time limit");
        expect(await presets[1].getText()).toContain("CIA simulation");
        expect(await presets[1].getText()).toContain("125 questions, 150 minutes");

        // Quick check is the start, with the multiple choice cards there are
        expect(await presets[0].getAttribute("aria-checked")).toBe("true");
        expect(await browser.$("#fs-exam-count").getValue()).toBe("20");
        expect(await browser.$(".fs-exam-options input[value=choice-only]").isSelected()).toBe(
            true,
        );
        expect(await browser.$(".fs-exam-status").getText()).toContain(
            "Only 3 questions are available",
        );

        // A preset fills the count and the time limit
        await presets[1].click();
        expect(await browser.$("#fs-exam-count").getValue()).toBe("125");
        expect(await browser.$("#fs-exam-minutes").getValue()).toBe("150");
        await presets[0].click();
        expect(await browser.$("#fs-exam-count").getValue()).toBe("20");

        // The title follows the decks until it is edited
        expect(await browser.$("#fs-exam-title").getValue()).toMatch(/^Exam · /);
        await screenshot("exam-setup", true);
        await setTheme(false);
        await screenshot("exam-setup", false);
        await setTheme(true);

        await pressStart();
        expect(await counter()).toBe("1 / 3");
    });

    it("asks the questions one at a time, and an answer is kept when coming back to it", async function () {
        await startExam(3);
        expect(await counter()).toBe("1 / 3");
        const first = await answerCurrent(true);
        expect(await browser.$(`${TILE}.is-selected`).isExisting()).toBe(true);

        // Changing the answer replaces it: one tile is chosen
        await browser.$(`${TILE}[data-option="${first.wrong}"]`).click();
        expect(await browser.$$(`${TILE}.is-selected`)).toHaveLength(1);
        expect(await browser.$(`${TILE}.is-selected`).getAttribute("data-option")).toBe(
            String(first.wrong),
        );

        await goNext();
        expect(await counter()).toBe("2 / 3");
        expect(await browser.$(`${TILE}.is-selected`).isExisting()).toBe(false);
        await browser.$(".fs-exam-prev").click();
        await browser.waitUntil(async () => (await counter()) === "1 / 3");
        await waitForQuestion();
        expect(await browser.$(`${TILE}.is-selected`).getAttribute("data-option")).toBe(
            String(first.wrong),
        );
        // The first question cannot go back further
        expect(await browser.$(".fs-exam-prev").isEnabled()).toBe(false);
    });

    it("scores an exam of two, saves the file, and studies the question that was missed", async function () {
        await startExam(2);
        expect(await counter()).toBe("1 / 2");
        // No time limit: the clock counts up
        expect(await browser.$(".fs-exam-timer-text").getText()).toMatch(/^\d+:\d\d$/);

        await answerCurrent(true);
        await goNext();
        const missed = await answerCurrent(false);
        await screenshot("exam-question", true);
        await setTheme(false);
        await screenshot("exam-question", false);
        await setTheme(true);

        await submitFromLast();
        expect(await resultPercent()).toBe("50%");
        expect(await browser.$(".fs-exam-hero-score").getText()).toBe("1 of 2 right");
        expect(await browser.$(".fs-exam-eyebrow").getText()).toMatch(/not passed/i);
        expect(await browser.$(".fs-exam-hero-sub").getText()).toBe("Pass mark 75%");
        // Exams do not touch the schedule of a card: no comment in the note
        await screenshot("exam-results", true);
        await setTheme(false);
        await screenshot("exam-results", false);
        await setTheme(true);

        // One file, with the score and a line per question
        const file = await waitForExamFile();
        expect(file.name).toMatch(/^\d{4}-\d\d-\d\d \d{4} exam\.md$/);
        expect(file.text).toContain("| Score | 50% (1 of 2) |");
        expect(file.text).toContain("| Result | Not passed (pass mark 75%) |");
        const block = file.text.split("\n");
        const start = block.indexOf("```fs-exam");
        expect(block.indexOf("```", start + 1) - start - 1).toBe(3);
        expect(examFiles()).toHaveLength(1);
        await browser.waitUntil(async () => (await browser.$(".fs-exam-saved").getText()) !== "");
        expect(await browser.$(".fs-exam-saved").getText()).toContain("Saved to");
        const note = fs.readFileSync(
            path.join(obsidianPage.getVaultPath(), "Syntax deck.md"),
            "utf8",
        );
        expect(note).not.toContain("<!--SR:");

        // The question that was missed is the first one listed, and open
        await browser.$(".fs-exam-item.is-open .fs-exam-item-question").waitForDisplayed();
        await browser.waitUntil(
            async () => (await browser.$(".fs-exam-item.is-open .fs-choice-text").getText()) !== "",
            { timeoutMsg: "the missed question was not drawn" },
        );
        expect(await browser.$(".fs-exam-item.is-open .fs-exam-item-question").getText()).toBe(
            missed.front,
        );
        expect(await browser.$$(".fs-exam-item.is-open .fs-choice.is-correct")).toHaveLength(1);
        expect(await browser.$$(".fs-exam-item.is-open .fs-choice.is-wrong")).toHaveLength(1);
        expect(await browser.$$(".fs-exam-item")).toHaveLength(1);

        // Study the ones I missed: a session of exactly that card
        const study = browser.$(".fs-exam-study");
        expect(await study.getText()).toContain("Study the ones I missed");
        await study.click();
        await browser
            .$(".sr-view .sr-card-container .fs-choice")
            .waitForDisplayed({ timeoutMsg: "no session of the missed card opened" });
        await browser.waitUntil(
            async () =>
                (await browser.$(".sr-view .sr-card-container .sr-content").getText()).includes(
                    missed.front,
                ),
            { timeoutMsg: "the session did not show the missed question" },
        );
        expect(await browser.$(".sr-view .fs-card-counter").getText()).toMatch(/^1 \/ 1$/);
    });

    it("the keys choose, move and flag, and the map follows", async function () {
        // A phone has no keyboard
        if (await isMobile()) this.skip();
        await startExam(3);
        // 2 chooses the second option of the question, in the order shown
        await browser.keys("2");
        await browser.waitUntil(
            async () => (await browser.$$(`${TILE}.is-selected`).length) === 1,
            { timeoutMsg: "the 2 key did not choose an option" },
        );
        const chosenPosition = await browser.execute(
            (css: string) =>
                Array.from(document.querySelectorAll(css)).findIndex((tile) =>
                    tile.classList.contains("is-selected"),
                ),
            TILE,
        );
        expect(chosenPosition).toBe(1);

        await browser.keys("f");
        await browser.waitUntil(
            async () => (await browser.$(".fs-exam-flag").getAttribute("aria-pressed")) === "true",
        );
        let front = await questionText();
        await browser.keys("ArrowRight");
        await waitForOtherQuestion(front);
        expect(await counter()).toBe("2 / 3");
        front = await questionText();
        await browser.keys("Enter");
        await waitForOtherQuestion(front);
        expect(await counter()).toBe("3 / 3");
        front = await questionText();
        await browser.keys("ArrowLeft");
        await waitForOtherQuestion(front);
        expect(await counter()).toBe("2 / 3");

        // The map: the first question is answered and flagged, the second is the one up
        const cells = await browser.execute(() =>
            Array.from(document.querySelectorAll(".fs-exam-cell")).map((cell) => cell.className),
        );
        expect(cells).toHaveLength(3);
        expect(cells[0]).toContain("is-answered");
        expect(cells[0]).toContain("is-flagged");
        expect(cells[1]).toContain("is-current");
        expect(cells[2]).not.toContain("is-answered");
    });

    it("the question map opens and jumps to a question", async function () {
        await startExam(3);
        if (await isMobile()) {
            // On a phone the map is a sheet under the counter
            expect(await browser.$(".fs-exam-map").isDisplayed()).toBe(false);
            await browser.$(".fs-exam-counter").click();
            await settle(".fs-exam-map");
            await screenshot("exam-map", true);
        } else {
            expect(await browser.$(".fs-exam-map").isDisplayed()).toBe(true);
            await screenshot("exam-map", true);
        }
        const front = await questionText();
        await browser.$('.fs-exam-cell[data-index="2"]').click();
        await waitForOtherQuestion(front);
        expect(await counter()).toBe("3 / 3");
        if (await isMobile()) {
            await browser.waitUntil(async () => !(await browser.$(".fs-exam-map").isDisplayed()), {
                timeoutMsg: "the sheet stayed open after choosing a question",
            });
        }
    });

    it("the submit dialog lists what is unanswered and flagged", async function () {
        await startExam(3);
        await answerCurrent(true);
        await browser.$(".fs-exam-flag").click();
        await goNext();
        await goNext();
        // On the last question, Next is Submit
        expect(await counter()).toBe("3 / 3");
        await browser.$(".fs-exam-next").click();
        const dialog = browser.$(".fs-exam-dialog");
        await dialog.waitForDisplayed();
        await settle(".fs-exam-dialog");
        const text = await dialog.getText();
        expect(text).toContain("Submit the exam?");
        expect(text).toContain("2 unanswered");
        expect(text).toContain("1 flagged for review");
        expect(text).toContain("Unanswered questions count as wrong.");
        await screenshot("exam-submit", true);

        // Go to the first unanswered question: the second one
        const buttons = await browser.$$(".fs-exam-dialog .fs-exam-ghost");
        await buttons[1].click();
        await browser.waitUntil(async () => (await counter()) === "2 / 3");
        expect(await browser.$(".fs-exam-dialog").isExisting()).toBe(false);
    });

    it("an exam with no answers scores 0% and every question is missed", async function () {
        await startExam(3);
        await goNext();
        await goNext();
        await browser.$(".fs-exam-next").click();
        await browser.$(".fs-exam-dialog").waitForDisplayed();
        await settle(".fs-exam-dialog");
        await browser.$(".fs-exam-dialog .fs-primary-button").click();
        await browser.$(".fs-exam-ring-value").waitForDisplayed();
        expect(await resultPercent()).toBe("0%");
        expect(await browser.$(".fs-exam-study").getText()).toContain("· 3");
        const file = await waitForExamFile();
        expect(file.text).toContain("| Score | 0% (0 of 3) |");
    });

    it("the CIA simulation asks 125 questions in 150 minutes, and the layout does not move between questions", async function () {
        await useNote(bigNote());
        await openSetup();
        await browser.$$(".fs-exam-preset")[1].click();
        expect(await browser.$("#fs-exam-count").getValue()).toBe("125");
        expect(await browser.$("#fs-exam-minutes").getValue()).toBe("150");
        expect(await browser.$(".fs-exam-status").getText()).toContain("130 questions available");
        // The questions are picked at random: a fixed sequence makes the same 125 come up every time, with long ones
        // among the first
        await browser.execute(() => {
            const w = window as unknown as { __realRandom?: () => number };
            w.__realRandom = Math.random;
            let seed = 7;
            Math.random = () => {
                seed = (seed * 16807) % 2147483647;
                return seed / 2147483647;
            };
        });
        await pressStart();
        await browser.execute(() => {
            const w = window as unknown as { __realRandom?: () => number };
            if (w.__realRandom !== undefined) Math.random = w.__realRandom;
        });
        expect(await counter()).toBe("1 / 125");
        expect(await browser.$(".fs-exam-timer-text").getText()).toMatch(/^2:(29:5\d|30:00)$/);
        expect(await browser.$$(".fs-exam-cell")).toHaveLength(125);
        // Two and a half hours is longer than five minutes: not orange
        expect(await browser.$(".fs-exam-timer").getAttribute("class")).not.toContain("is-low");

        // What is fixed stays where it is, for a short question and a long one, and after answering
        const fixed = async () =>
            browser.execute(() => {
                const rect = (css: string) => {
                    const box = document.querySelector(css)?.getBoundingClientRect();
                    return box === undefined
                        ? null
                        : [box.x, box.y, box.width, box.height].map((n) => Math.round(n));
                };
                // A button pressed a moment ago is still drawn a little smaller: its size in the layout is what counts
                const size = (css: string) => {
                    const el = document.querySelector<HTMLElement>(css);
                    return el === null ? null : [el.offsetWidth, el.offsetHeight];
                };
                return {
                    bar: rect(".fs-exam-bar"),
                    counter: rect(".fs-exam-counter"),
                    timer: rect(".fs-exam-timer"),
                    stage: rect(".fs-exam-stage"),
                    footer: rect(".fs-exam-footer"),
                    prev: size(".fs-exam-prev"),
                    next: size(".fs-exam-next"),
                    map: rect(".fs-exam-map"),
                    // Where the card is in the stage, whatever the stage has scrolled by
                    body: (() => {
                        const card = document
                            .querySelector(".fs-exam-question-body:not(.is-pending)")
                            ?.getBoundingClientRect();
                        const stage = document.querySelector(".fs-exam-stage");
                        if (card === undefined || stage === null) return null;
                        const top = stage.getBoundingClientRect().y;
                        return [
                            card.x,
                            card.y - top + stage.scrollTop,
                            card.width,
                            card.height,
                        ].map((n) => Math.round(n));
                    })(),
                };
            });
        const seen: string[] = [];
        let shot = false;
        const first = await fixed();
        // The shape of the card is its own: only its height follows the question
        const { body: firstBody, ...firstFixed } = first;
        for (let step = 0; step < 6; step++) {
            const text = await questionText();
            seen.push(text.slice(0, 40));
            await browser.$(`${TILE}[data-option="1"]`).click();
            const now = await fixed();
            const { body, ...rest } = now;
            expect(rest).toEqual(firstFixed);
            // The card keeps its left edge and its width
            expect(body?.[0]).toBe(firstBody?.[0]);
            expect(body?.[2]).toBe(firstBody?.[2]);
            expect(body?.[1]).toBe(firstBody?.[1]);
            // A long question, for a look at how the card holds a scenario
            if (text.includes("An internal auditor") && !shot) {
                shot = true;
                await screenshot("exam-cia", true);
                await setTheme(false);
                await screenshot("exam-cia", false);
                await setTheme(true);
            }
            await goNext();
        }
        expect(new Set(seen).size).toBe(6);
        // The six included a long question, so the check above covered a card of another height
        expect(shot).toBe(true);

        // The map jumps to the last question, where Next says Submit
        const front = await questionText();
        if (await isMobile()) {
            await browser.$(".fs-exam-counter").click();
            await settle(".fs-exam-map");
        }
        await browser.$('.fs-exam-cell[data-index="124"]').click();
        await waitForOtherQuestion(front);
        expect(await counter()).toBe("125 / 125");
        expect(await browser.$(".fs-exam-next").getText()).toBe("Submit");
        expect((await fixed()).footer).toEqual(firstFixed.footer);
    });

    it("leaving asks first, and keeps the exam when the person keeps going", async function () {
        await startExam(3);
        await answerCurrent(true);
        await browser.$(".fs-exam .fs-exam-bar .fs-exam-icon-button").click();
        const dialog = browser.$(".fs-exam-dialog");
        await dialog.waitForDisplayed();
        await settle(".fs-exam-dialog");
        expect(await dialog.getText()).toContain("Leave the exam?");
        // Keep going is the first button, and has the focus
        await browser.$(".fs-exam-dialog .fs-exam-ghost").click();
        expect(await browser.$(".fs-exam-dialog").isExisting()).toBe(false);
        expect(await counter()).toBe("1 / 3");
        expect(await browser.$(`${TILE}.is-selected`).isExisting()).toBe(true);
        expect(examFiles()).toHaveLength(0);
    });

    it("a time limit counts down, turns orange under five minutes, and submits when it runs out", async function () {
        await startExam(3, { minutes: 1 });
        const timer = browser.$(".fs-exam-timer");
        expect(await timer.getText()).toMatch(/^(0:5\d|1:00)$/);
        // One minute is under the five minutes that turn it orange
        expect(await timer.getAttribute("class")).toContain("is-low");
        await answerCurrent(true);

        // The clock is the wall clock: jump it past the limit, and the next tick submits
        await browser.execute(() => {
            const w = window as unknown as { __realNow?: () => number };
            w.__realNow = Date.now.bind(Date);
            const real = w.__realNow;
            Date.now = () => real() + 2 * 60_000;
        });
        await browser.$(".fs-exam-ring-value").waitForDisplayed({
            timeout: 5000,
            timeoutMsg: "time running out did not submit the exam",
        });
        // The answer given counts, the others do not
        expect(await browser.$(".fs-exam-hero-score").getText()).toMatch(/^[01] of 3 right$/);
        const file = await waitForExamFile();
        expect(file.text).toContain("of 3)");
    });

    it("asks a typed question and a self-marked one in an exam of all cards", async function () {
        await useNote(MIXED_NOTE);
        await openSetup();
        await setNumber("fs-exam-count", 3);
        await chooseCards("all");
        expect(await browser.$(".fs-exam-status").getText()).toContain("3 questions available");
        await pressStart();

        // Answer each question by its kind, whichever order they come in
        let typed = false;
        let self = false;
        for (let index = 0; index < 3; index++) {
            await waitForQuestion();
            const front = await questionText();
            if (front.startsWith("What does CAE")) {
                const input = browser.$(`${BODY} .fs-typed-input`);
                await input.setValue("chief audit executive.");
                typed = true;
            } else if (front.startsWith("Explain independence")) {
                await browser.$(`${BODY} .fs-exam-reveal`).click();
                await browser
                    .$(`${BODY} .fs-exam-self-answer`)
                    .waitForDisplayed({ timeoutMsg: "the answer was not shown" });
                await browser.$(`${BODY} .fs-exam-self-button.is-yes`).click();
                expect(
                    await browser
                        .$(`${BODY} .fs-exam-self-button.is-yes`)
                        .getAttribute("aria-pressed"),
                ).toBe("true");
                self = true;
            } else {
                await browser.$(`${TILE}[data-option="1"]`).click();
            }
            if (index < 2) await goNext();
        }
        expect(typed && self).toBe(true);
        await submitFromLast();
        expect(await resultPercent()).toBe("100%");
        expect(await browser.$(".fs-exam-eyebrow").getText()).toMatch(/passed/i);
        expect(await browser.$(".fs-exam-perfect").isExisting()).toBe(true);
        expect(await browser.$(".fs-exam-study").isExisting()).toBe(false);
        await screenshot("exam-results-passed", true);
    });

    it("the setup lists the recent exams and starts from the last one", async function () {
        await startExam(2);
        await answerCurrent(true);
        await goNext();
        await answerCurrent(true);
        await submitFromLast();
        await waitForExamFile();
        await closeEverything();

        await openSetup();
        expect(await browser.$(".fs-exam-recent-row").isExisting()).toBe(true);
        expect(await browser.$(".fs-exam-recent-score").getText()).toBe("100%");
        expect(await browser.$(".fs-exam-recent-detail").getText()).toContain("2 of 2");
        // Retaking is one press: the setup starts from what the last exam was
        expect(await browser.$("#fs-exam-count").getValue()).toBe("2");
        await screenshot("exam-setup-recent", true);
    });

    it("the exam files are history, not cards", async function () {
        await startExam(2);
        await answerCurrent(true);
        await goNext();
        await answerCurrent(false);
        await submitFromLast();
        await waitForExamFile();

        await setSettings({ convertFoldersToDecks: true });
        const decks = await browser.executeObsidian(async ({ app }, id) => {
            const plugin = (
                app as unknown as {
                    plugins: {
                        plugins: Record<
                            string,
                            {
                                dataManager: {
                                    sync: () => Promise<void>;
                                    osrCore: {
                                        reviewableDeckTree: {
                                            toDeckArray: () => {
                                                getTopicPath: () => { path: string[] };
                                            }[];
                                        };
                                    };
                                };
                            }
                        >;
                    };
                }
            ).plugins.plugins[id];
            await plugin.dataManager.sync();
            return plugin.dataManager.osrCore.reviewableDeckTree
                .toDeckArray()
                .map((deck) => deck.getTopicPath().path.join("/"));
        }, pluginId);
        expect(decks.some((deck) => deck.startsWith("Flashcard Studio"))).toBe(false);
        await setSettings({ convertFoldersToDecks: false });
    });

    it("the desktop shell shows Exams, Take an exam, Create with AI, and takes the exam in its main area", async function () {
        if (await isMobile()) this.skip();
        await useShell();
        await browser.$(`${SHELL} .fs-desktop-home`).waitForDisplayed({
            timeoutMsg: "the desktop home was not shown",
        });
        const labels = await browser.execute(
            (css: string) =>
                Array.from(document.querySelectorAll(css)).map((el) =>
                    el.getAttribute("aria-label"),
                ),
            `${SHELL} .fs-desktop-nav .fs-desktop-nav-item`,
        );
        expect(labels).toEqual([
            "Home",
            "Study",
            "Exams",
            "Browse cards",
            "Statistics",
            "Create with AI",
        ]);

        // The button beside Study all, and no Last exam card before the first exam
        expect(await browser.$(`${SHELL} .fs-dh-button:not(.is-primary)`).getText()).toBe(
            "Take an exam",
        );
        expect(await browser.$(`${SHELL} .fs-dh-exam`).isExisting()).toBe(false);
        await screenshot("exam-home-before", true);

        // Take an exam: the setup, then the exam inside the shell, whose sidebar is a rail
        await browser.$(`${SHELL} .fs-dh-button:not(.is-primary)`).click();
        await browser.$(".fs-exam-modal .fs-exam-presets").waitForDisplayed();
        await settle(".fs-exam-modal");
        await setNumber("fs-exam-count", 2);
        await pressStart();
        expect(await browser.$(`${SHELL} .fs-exam-host .fs-exam`).isExisting()).toBe(true);
        expect(await browser.$(SHELL).getAttribute("class")).toContain("is-rail");
        expect(await browser.$(`${SHELL} .fs-desktop-side`).getSize("width")).toBeCloseTo(64, 0);
        expect(
            await browser.$(`${SHELL} .fs-desktop-nav-item.is-active`).getAttribute("aria-label"),
        ).toBe("Exams");
        // No exam tab: it is in the shell
        expect(
            await browser.executeObsidian(
                ({ app }, type) => app.workspace.getLeavesOfType(type).length,
                EXAM_VIEW,
            ),
        ).toBe(0);
        await screenshot("exam-in-shell", true);

        // Leaving through the sidebar asks first
        await answerCurrent(true);
        await browser.$(`${SHELL} .fs-desktop-nav-item[aria-label="Home"]`).click();
        await browser.$(".fs-exam-dialog").waitForDisplayed();
        await settle(".fs-exam-dialog");
        await browser.$(".fs-exam-dialog .fs-exam-ghost").click();
        expect(await browser.$(`${SHELL} .fs-exam-host .fs-exam`).isExisting()).toBe(true);

        // Finish: one right, one wrong
        await goNext();
        await answerCurrent(false);
        await submitFromLast();
        expect(await resultPercent()).toBe("50%");
        await waitForExamFile();

        // Study the ones I missed goes on inside the shell: one card
        await browser.$(".fs-exam-study").click();
        await browser.$(`${SHELL}.is-study`).waitForExist({ timeoutMsg: "no study session" });
        await browser
            .$(`${SHELL} .sr-card-container .fs-choice`)
            .waitForDisplayed({ timeoutMsg: "the missed card was not shown" });
        expect(await browser.$(SHELL).getAttribute("class")).not.toContain("is-rail");
        expect(await browser.$(`${SHELL} .fs-card-counter`).getText()).toMatch(/^1 \/ 1$/);

        // Back on the home, the Last exam card shows the score and Retake
        await browser.$(`${SHELL} .fs-desktop-nav-item[aria-label="Home"]`).click();
        await browser.$(`${SHELL} .fs-dh-exam`).waitForDisplayed({
            timeoutMsg: "the Last exam card was not shown",
        });
        expect(await browser.$(`${SHELL} .fs-dh-exam-ring`).getText()).toBe("50%");
        expect(await browser.$(`${SHELL} .fs-dh-exam-eyebrow`).getText()).toMatch(
            /LAST EXAM · NOT PASSED/i,
        );
        expect(await browser.$(`${SHELL} .fs-dh-exam-detail`).getText()).toContain("1 of 2 right");
        await screenshot("exam-home", true);
        await setTheme(false);
        await screenshot("exam-home", false);
        await setTheme(true);

        // Retake opens the setup, filled in as the last exam was
        await browser.$(`${SHELL} .fs-dh-exam .fs-dh-button`).click();
        await browser.$(".fs-exam-modal .fs-exam-presets").waitForDisplayed();
        expect(await browser.$("#fs-exam-count").getValue()).toBe("2");
    });

    it("Create with AI asks for a note, then opens the generate cards dialog", async function () {
        if (await isMobile()) this.skip();
        await useShell();
        await browser.$(`${SHELL} .fs-desktop-home`).waitForDisplayed();
        await browser.$(`${SHELL} .fs-desktop-nav-item[aria-label="Create with AI"]`).click();
        const picker = browser.$(".prompt");
        await picker.waitForDisplayed({ timeoutMsg: "the note picker was not shown" });
        expect(await browser.$(".prompt-input").getAttribute("placeholder")).toBe(
            "Choose a note to make cards from",
        );
        // The note of this spec is listed, the most recently changed first
        const first = await browser.$(".prompt-results .suggestion-item").getText();
        expect(first).toContain("Syntax deck.md");
        await browser.$(".prompt-results .suggestion-item").click();
        await browser.$(".fs-ai-modal").waitForDisplayed({
            timeoutMsg: "the generate cards dialog did not open",
        });
        expect(await browser.$(".fs-ai-source-name").getText()).toBe("Whole note");
    });

    it("the phone home has a Take an exam row", async function () {
        if (!(await isMobile())) this.skip();
        // Two decks, so the review opens on the home and not on the cards of the only deck
        await setSettings({ flashcardTags: [TAG, "#flashcards"] });
        await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
        const row = browser.$(".sr-view .fs-home-exam");
        await row.waitForDisplayed({ timeoutMsg: "the home has no exam row" });
        expect(await row.getText()).toContain("Take an exam");
        await screenshot("exam-home-row", true);
        await row.click();
        await browser.$(".fs-exam-modal .fs-exam-presets").waitForDisplayed();
        await settle(".fs-exam-modal");
        await setNumber("fs-exam-count", 2);
        await pressStart();
        // The exam is in a tab of its own, and the Studio has made room for it
        expect(
            await browser.executeObsidian(
                ({ app }, type) => app.workspace.getLeavesOfType(type).length,
                EXAM_VIEW,
            ),
        ).toBe(1);
        expect(await counter()).toBe("1 / 2");
    });
});
