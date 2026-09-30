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

/** Opens the Studio as a tab with the desktop shell, as an install on the desktop has it by default. */
async function useShell(): Promise<void> {
    // The tab setting is left off, as it is by default: the Desktop layout setting is what opens the tab
    await setSettings({ desktopLayout: true, openViewInNewTab: false });
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

/** Sends a key press to the page, as a keyboard with any layout would: what the key gives, and where it is. */
async function pressKey(init: { key: string; code: string }): Promise<boolean> {
    return browser.execute((key: { key: string; code: string }) => {
        const target = document.activeElement ?? document.body;
        // True when the exam took the key: it is the one that stops the key from doing anything else
        return !target.dispatchEvent(
            new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }),
        );
    }, init);
}

/**
 * Where the plugin keeps the exams that were started and not finished: a file of its own for each, in the plugin's
 * folder of the vault (`exam-drafts/<exam>-<device>.json`), not in `data.json`.
 */
function draftsDir(): string {
    return path.join(obsidianPage.getVaultPath(), ".obsidian", "plugins", pluginId, "exam-drafts");
}

function draftFiles(): string[] {
    const dir = draftsDir();
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
}

interface DraftOnDisk {
    id: string;
    startedMs: number;
    savedMs: number;
    current: number;
    questions: Record<string, unknown>[];
    answers: { chosen: number[]; flagged: boolean; typed: string }[];
}

function readDraftFile(name: string): DraftOnDisk {
    return JSON.parse(fs.readFileSync(path.join(draftsDir(), name), "utf8")) as DraftOnDisk;
}

/** The exams that were started and not finished, by the files that hold them. */
async function draftIds(): Promise<string[]> {
    return draftFiles().map((name) => readDraftFile(name).id);
}

/** What `data.json` holds of the plugin's data, read from the disk after the plugin has written it. */
async function pluginDataOnDisk(): Promise<Record<string, unknown>> {
    await browser.executeObsidian(async ({ app }, id) => {
        const plugin = (
            app as unknown as {
                plugins: {
                    plugins: Record<
                        string,
                        {
                            dataManager: {
                                pluginDataManager: { savePluginData: () => Promise<void> };
                            };
                        }
                    >;
                };
            }
        ).plugins.plugins[id];
        await plugin.dataManager.pluginDataManager.savePluginData();
    }, pluginId);
    const file = path.join(
        obsidianPage.getVaultPath(),
        ".obsidian",
        "plugins",
        pluginId,
        "data.json",
    );
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

async function clearDrafts(): Promise<void> {
    fs.rmSync(draftsDir(), { recursive: true, force: true });
}

/** Closes the exam's tab, as the person does with the tab's own close button: the exam is not left, only put away. */
async function closeExamTab(): Promise<void> {
    await browser.executeObsidian(({ app }, type) => {
        app.workspace.detachLeavesOfType(type);
    }, EXAM_VIEW);
    await browser.$(".fs-exam").waitForExist({ reverse: true, timeoutMsg: "the exam tab stayed" });
}

async function noticeText(): Promise<string> {
    return browser.execute(() =>
        Array.from(document.querySelectorAll(".notice"))
            .map((notice) => notice.textContent ?? "")
            .join("\n"),
    );
}

const HEART_BLOCK = [
    "```image-occlusion",
    "image: [[Heart.png]]",
    "mode: hide-all",
    "question: Name the labelled chamber",
    "mask: ra rect 0.1440 0.2891 0.2520 0.0984 | Right atrium",
    "mask: lv ellipse 0.5500 0.6600 0.3600 0.1600 | Left **ventricle**",
    "mask: cc rect 0.7000 0.1000 0.1000 0.1000 | a `code` label",
    "```",
].join("\n");
const OCCLUSION_NOTE = [TAG, "", HEART_BLOCK, ""].join("\n");

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
            desktopLayout: false,
            openViewInNewTab: false,
        });
        if (!(await isMobile())) {
            await useFullWindow();
            await setTheme(true);
        }
        // Earlier tests leave their exams in the vault folder; the vault reset does not know about them
        for (const name of examFiles()) {
            fs.rmSync(path.join(obsidianPage.getVaultPath(), EXAMS_FOLDER, name));
        }
        // Progress that earlier tests left behind would be offered for resuming
        await clearDrafts();
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
        // No time limit: a stopwatch, not a countdown
        expect(await browser.$(".fs-exam-timer.is-elapsed").isExisting()).toBe(true);
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
        await startExam(2, { minutes: 90 });
        expect(await counter()).toBe("1 / 2");
        // A time limit: a countdown from 1:30:00, and not the stopwatch of an exam without one
        expect(await browser.$(".fs-exam-timer-text").getText()).toMatch(/^1:(29:5\d|30:00)$/);
        expect(await browser.$(".fs-exam-timer.is-elapsed").isExisting()).toBe(false);

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
        // The text of the question is drawn by Obsidian a moment after the element is there
        await browser.waitUntil(
            async () =>
                (await browser.$(".fs-exam-item.is-open .fs-exam-item-question").getText()) ===
                missed.front,
            { timeoutMsg: "the missed question was not drawn in the list" },
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

    it("the keys are read by their place: F flags on an Arabic layout, the number row chooses on AZERTY", async function () {
        if (await isMobile()) this.skip();
        await startExam(3);
        // AZERTY: the second key of the number row gives "é", and shifted "2"
        expect(await pressKey({ key: "é", code: "Digit2" })).toBe(true);
        await browser.waitUntil(
            async () => (await browser.$$(`${TILE}.is-selected`).length) === 1,
            {
                timeoutMsg: "the number row did not choose an option on AZERTY",
            },
        );
        const position = await browser.execute(
            (css: string) =>
                Array.from(document.querySelectorAll(css)).findIndex((tile) =>
                    tile.classList.contains("is-selected"),
                ),
            TILE,
        );
        expect(position).toBe(1);

        // The numpad, and Arabic-Indic digits, are the same keys
        expect(await pressKey({ key: "1", code: "Numpad1" })).toBe(true);
        await browser.waitUntil(
            async () =>
                (await browser.$(`${TILE}.is-selected`).getAttribute("data-option")) !== null,
        );

        // Arabic: the F key gives "ب"
        expect(await pressKey({ key: "ب", code: "KeyF" })).toBe(true);
        await browser.waitUntil(
            async () => (await browser.$(".fs-exam-flag").getAttribute("aria-pressed")) === "true",
            { timeoutMsg: "F did not flag the question on an Arabic layout" },
        );
        // A letter on the wrong key is not the exam's
        expect(await pressKey({ key: "f", code: "KeyG" })).toBe(false);
    });

    it("the keys are the exam's only while its own view is the active one", async function () {
        if (await isMobile()) this.skip();
        await startExam(3);
        // A note in a pane beside the exam, and the focus there
        await browser.executeObsidian(async ({ app }, notePath) => {
            const file = app.vault.getFileByPath(notePath);
            if (file === null) throw new Error(`${notePath} is not in the vault`);
            const leaf = app.workspace.getLeaf("split");
            await leaf.openFile(file);
            app.workspace.setActiveLeaf(leaf, { focus: true });
        }, "Syntax deck.md");
        await browser.pause(300);

        // Enter, the arrows, F and the digits are the note's: the exam does not take them, or stop them
        for (const key of [
            { key: "Enter", code: "Enter" },
            { key: "ArrowRight", code: "ArrowRight" },
            { key: "f", code: "KeyF" },
            { key: "1", code: "Digit1" },
        ]) {
            // (The note's editor may take the key itself; what matters is that the exam did not)
            await pressKey(key);
        }
        expect(await counter()).toBe("1 / 3");
        expect(await browser.$(".fs-exam-flag").getAttribute("aria-pressed")).toBe("false");
        expect(await browser.$(`${TILE}.is-selected`).isExisting()).toBe(false);

        // Back in the exam's pane they are the exam's
        await browser.executeObsidian(({ app }, type) => {
            const leaf = app.workspace.getLeavesOfType(type)[0];
            app.workspace.setActiveLeaf(leaf, { focus: true });
        }, EXAM_VIEW);
        await browser.pause(300);
        const front = await questionText();
        expect(await pressKey({ key: "ArrowRight", code: "ArrowRight" })).toBe(true);
        await waitForOtherQuestion(front);
        expect(await counter()).toBe("2 / 3");
    });

    it("progress is saved as the exam goes: close the tab, resume, and the answers and the place are as they were", async function () {
        await startExam(3, { minutes: 90 });
        await answerCurrent(true);
        await goNext();
        const second = await answerCurrent(false);
        await browser.$(".fs-exam-flag").click();
        await browser.waitUntil(async () => (await draftIds()).length === 1, {
            timeoutMsg: "the progress was never saved",
        });
        // The file has what has been done: the place, the first answer, the second and the flag
        await browser.waitUntil(
            () => {
                const draft = readDraftFile(draftFiles()[0]);
                return draft.current === 1 && draft.answers[1].flagged;
            },
            { timeoutMsg: "the file of the exam never had the flag and the place" },
        );
        expect(draftFiles()).toHaveLength(1);
        // Named for the exam and for this device, as the review log's files are
        expect(draftFiles()[0]).toMatch(/^\d+-[a-z]+-[0-9a-z]{4}\.json$/);
        const onDisk = readDraftFile(draftFiles()[0]);
        expect(onDisk.answers[0].chosen).toHaveLength(1);
        expect(onDisk.answers[1].chosen).toEqual([second.wrong]);
        // The options of a multiple choice question are in its answer text once, not again as a parsed copy
        expect(onDisk.questions).toHaveLength(3);
        expect(onDisk.questions.some((question) => "choice" in question)).toBe(false);
        // and none of it is in data.json, which the settings and the schedules share with the other devices
        expect(Object.keys(await pluginDataOnDisk())).not.toContain("examDrafts");

        await closeExamTab();
        // The progress is still there: closing a tab is not leaving the exam
        expect(await draftIds()).toHaveLength(1);

        // Exams offers it first
        await openSetup();
        const draft = browser.$(".fs-exam-draft");
        await draft.waitForDisplayed({ timeoutMsg: "no unfinished exam was offered" });
        expect(await draft.getText()).toMatch(/2 \/ 3 · 1 h (29|30) min left/);
        expect(await browser.$(".fs-exam-draft-resume").getText()).toBe("Resume exam");
        await screenshot("exam-resume", true);
        await browser.$(".fs-exam-draft-resume").click();
        await browser.$(BODY).waitForDisplayed({ timeoutMsg: "the exam did not come back" });
        await waitForQuestion();

        // The same question, the same answer, the flag, and the map
        expect(await counter()).toBe("2 / 3");
        expect(await questionText()).toBe(second.front);
        expect(await browser.$(`${TILE}.is-selected`).getAttribute("data-option")).toBe(
            String(second.wrong),
        );
        expect(await browser.$(".fs-exam-flag").getAttribute("aria-pressed")).toBe("true");
        const cells = await browser.execute(() =>
            Array.from(document.querySelectorAll(".fs-exam-cell")).map((cell) => cell.className),
        );
        expect(cells[0]).toContain("is-answered");
        expect(cells[1]).toContain("is-flagged");
        // The clock is the one it started with: about 90 minutes from when it began, less what has passed
        expect(await browser.$(".fs-exam-timer-text").getText()).toMatch(/^1:(29|30):\d\d$/);

        // The first answer is there too
        const front = await questionText();
        await browser.$(".fs-exam-prev").click();
        await waitForOtherQuestion(front);
        const first = known(await questionText());
        expect(await browser.$(`${TILE}.is-selected`).getAttribute("data-option")).toBe(
            String(first.right),
        );

        // Submitting drops the saved progress once the results file is written
        await goNext();
        await goNext();
        await browser.$(".fs-exam-next").click();
        await browser.$(".fs-exam-dialog").waitForDisplayed();
        await settle(".fs-exam-dialog");
        await browser.$(".fs-exam-dialog .fs-primary-button").click();
        await browser.$(".fs-exam-ring-value").waitForDisplayed();
        await waitForExamFile();
        await browser.waitUntil(async () => (await draftIds()).length === 0, {
            timeoutMsg: "the saved progress stayed after the exam was submitted",
        });
    });

    it("an exam that is only being looked at is not written again: the file changes when the exam does", async function () {
        await startExam(3);
        await answerCurrent(true);
        const answered = () => {
            const [name] = draftFiles();
            return name !== undefined && readDraftFile(name).answers[0].chosen.length === 1;
        };
        await browser.waitUntil(answered, { timeoutMsg: "the answer was never saved" });
        // Let the write that followed the answer finish
        await browser.pause(500);
        const file = path.join(draftsDir(), draftFiles()[0]);
        const before = { modified: fs.statSync(file).mtimeMs, text: fs.readFileSync(file, "utf8") };

        // The clock runs for longer than the fifteen seconds it used to save at, whatever was being done
        await browser.pause(17_000);
        expect(fs.statSync(file).mtimeMs).toBe(before.modified);
        expect(fs.readFileSync(file, "utf8")).toBe(before.text);

        // Moving on is a change, and is written
        await goNext();
        await browser.waitUntil(() => fs.statSync(file).mtimeMs > before.modified, {
            timeoutMsg: "moving to the next question was not saved",
        });
        expect(readDraftFile(draftFiles()[0]).current).toBe(1);
    });

    it("leaving the exam for good throws the saved progress away", async function () {
        await startExam(3);
        await answerCurrent(true);
        await browser.waitUntil(async () => (await draftIds()).length === 1);
        await browser.$(".fs-exam .fs-exam-bar .fs-exam-icon-button").click();
        await browser.$(".fs-exam-dialog").waitForDisplayed();
        await settle(".fs-exam-dialog");
        // The dialog says what leaving means, and how to put the exam away instead
        expect(await browser.$(".fs-exam-dialog").getText()).toContain("close the tab instead");
        await browser.$(".fs-exam-dialog .fs-primary-button").click();
        await browser.$(".fs-exam").waitForExist({ reverse: true, timeoutMsg: "the exam stayed" });
        expect(await draftIds()).toHaveLength(0);
    });

    it("an exam whose time ran out while it was closed is submitted with the answers it had, ending at its deadline", async function () {
        await startExam(3, { minutes: 1 });
        await answerCurrent(true);
        await browser.waitUntil(async () => (await draftIds()).length === 1);
        await closeExamTab();

        // Five minutes go by: the deadline was one minute after the start
        for (const name of draftFiles()) {
            const file = path.join(draftsDir(), name);
            const draft = readDraftFile(name);
            draft.startedMs -= 5 * 60_000;
            fs.writeFileSync(file, JSON.stringify(draft));
        }

        await openSetup();
        expect(await browser.$(".fs-exam-draft").getText()).toContain("Time ran out");
        expect(await browser.$(".fs-exam-draft-resume").getText()).toBe("See results");
        await browser.$(".fs-exam-draft-resume").click();
        await browser.$(".fs-exam-ring-value").waitForDisplayed({
            timeoutMsg: "the exam that ran out was not submitted",
        });
        // The answer given counts; the exam took its minute, not the five that passed
        expect(await browser.$(".fs-exam-hero-score").getText()).toMatch(/^[01] of 3 right$/);
        const file = await waitForExamFile();
        expect(file.text).toContain("| Time taken | 1 min |");
        await browser.waitUntil(async () => (await draftIds()).length === 0);
    });

    it("an unfinished exam is offered when Obsidian starts, and Discard needs a second press", async function () {
        await startExam(3);
        await answerCurrent(true);
        await browser.waitUntil(async () => (await draftIds()).length === 1);
        await closeExamTab();

        await browser.executeObsidian(({ app }, id) => {
            (
                app as unknown as {
                    plugins: {
                        plugins: Record<string, { uiManager: { offerExamResume: () => void } }>;
                    };
                }
            ).plugins.plugins[id].uiManager.offerExamResume();
        }, pluginId);
        const row = browser.$(".fs-exam-resume-modal .fs-exam-draft");
        await row.waitForDisplayed({ timeoutMsg: "the offer to resume was not shown" });
        await settle(".fs-exam-resume-modal");
        expect(await row.getText()).toMatch(/1 \/ 3 · No limit/);

        // One press only arms it; the exam is still there
        await browser.$(".fs-exam-draft-discard").click();
        expect(await browser.$(".fs-exam-draft-discard").getText()).toBe("Discard for good");
        expect(await draftIds()).toHaveLength(1);
        // Later leaves it
        await browser.$(".fs-exam-resume-modal .fs-exam-ghost:not(.fs-exam-draft-discard)").click();
        await browser.$(".fs-exam-resume-modal").waitForExist({ reverse: true });
        expect(await draftIds()).toHaveLength(1);

        // Offered again, and this time discarded
        await browser.executeObsidian(({ app }, id) => {
            (
                app as unknown as {
                    plugins: {
                        plugins: Record<string, { uiManager: { offerExamResume: () => void } }>;
                    };
                }
            ).plugins.plugins[id].uiManager.offerExamResume();
        }, pluginId);
        await browser.$(".fs-exam-resume-modal .fs-exam-draft").waitForDisplayed();
        await settle(".fs-exam-resume-modal");
        await browser.$(".fs-exam-draft-discard").click();
        await browser.$(".fs-exam-draft-discard").click();
        await browser.$(".fs-exam-resume-modal").waitForExist({ reverse: true });
        expect(await draftIds()).toHaveLength(0);
    });

    it("Study the ones I missed says when cards changed since the exam, and keeps the results when none can be found", async function () {
        await startExam(3);
        for (let index = 0; index < 3; index++) {
            await answerCurrent(false);
            if (index < 2) await goNext();
        }
        await submitFromLast();
        await waitForExamFile();
        expect(await browser.$(".fs-exam-study").getText()).toContain("· 3");

        // One card is edited after the exam: it cannot be found, and the person is told
        await obsidianPage.write(
            "Syntax deck.md",
            CHOICE_NOTE.replace(QUESTIONS[0].front, `${QUESTIONS[0].front} (edited)`),
        );
        await browser.pause(800);
        await browser.$(".fs-exam-study").click();
        await browser
            .$(".sr-view .sr-card-container .fs-choice")
            .waitForDisplayed({ timeoutMsg: "no session of the cards that were found opened" });
        expect(await noticeText()).toContain("1 card changed since the exam and was left out.");
        expect(await browser.$(".sr-view .fs-card-counter").getText()).toMatch(/^1 \/ 2$/);
        await browser.keys("Escape");
        await browser.$(".sr-view").waitForExist({ reverse: true });
        await browser.execute(() => {
            document.querySelectorAll(".notice").forEach((notice) => notice.remove());
        });

        // Every card is edited: nothing to study, so nothing opens and the results are still there to read
        await obsidianPage.write(
            "Syntax deck.md",
            QUESTIONS.reduce(
                (text, q) => text.replace(q.front, `${q.front} (edited again)`),
                CHOICE_NOTE.replace(QUESTIONS[0].front, `${QUESTIONS[0].front} (edited)`),
            ),
        );
        await browser.pause(800);
        await browser.$(".fs-exam-study").click();
        await browser.waitUntil(async () => (await noticeText()).includes("None of those cards"), {
            timeoutMsg: "no notice said that the cards could not be found",
        });
        expect(await browser.$(".sr-view").isExisting()).toBe(false);
        expect(await browser.$(".fs-exam-ring-value").isDisplayed()).toBe(true);
    });

    it("occlusion cards are asked in an exam: the label is typed, or marked by the person, and the list never shows the data", async function () {
        await useNote(OCCLUSION_NOTE);
        await openSetup();
        await setNumber("fs-exam-count", 3);
        await chooseCards("all");
        expect(await browser.$(".fs-exam-status").getText()).toContain("3 questions available");
        await pressStart();

        // Each question is a picture with one mask asked about; which one it is shows in the mask's shape and place
        for (let index = 0; index < 3; index++) {
            await browser
                .$(`${BODY} .fs-occ-image`)
                .waitForDisplayed({ timeoutMsg: "the picture of the question was not shown" });
            await browser.waitUntil(
                () =>
                    browser.execute((css: string) => {
                        const img = document.querySelector<HTMLImageElement>(css);
                        return img !== null && img.complete && img.naturalWidth > 0;
                    }, `${BODY} .fs-occ-image`),
                { timeoutMsg: "the picture did not load" },
            );
            const asked = await browser.execute((css: string) => {
                const mask = document.querySelector(`${css} .fs-mask.is-active`);
                if (mask === null) return "";
                if (mask.tagName.toLowerCase() === "ellipse") return "ventricle";
                return mask.getAttribute("x")?.startsWith("0.7") ? "code" : "atrium";
            }, BODY);
            expect(asked).not.toBe("");
            if (index === 0) await screenshot("exam-occlusion-question", true);
            if (asked === "code") {
                // A label that is not plain text cannot be typed: the person says whether they knew it
                await browser.$(`${BODY} .fs-exam-reveal`).click();
                await browser.$(`${BODY} .fs-exam-self-answer`).waitForDisplayed();
                await browser.$(`${BODY} .fs-exam-self-button.is-yes`).click();
            } else {
                const input = browser.$(`${BODY} .fs-typed-input`);
                await input.waitForDisplayed({ timeoutMsg: "an occlusion question has no field" });
                await input.setValue(asked === "atrium" ? "right atrium" : "Left Ventricle.");
            }
            if (index < 2) {
                // The three questions read the same, so the counter is what shows that the next one is up
                const before = await counter();
                await browser.$(".fs-exam-next").click();
                await browser.waitUntil(async () => (await counter()) !== before, {
                    timeoutMsg: "Next did not move to the next question",
                });
            }
        }
        await submitFromLast();
        expect(await resultPercent()).toBe("100%");

        // The list names each card by the question on its block, not by the fence it is drawn from
        const texts = await browser.execute(() =>
            Array.from(document.querySelectorAll(".fs-exam-item-text")).map(
                (el) => el.textContent ?? "",
            ),
        );
        expect(texts).toHaveLength(3);
        for (const text of texts) expect(text).toBe("Name the labelled chamber");
        // The first is open: the picture, with the typed label under it
        await browser
            .$(".fs-exam-item.is-open .fs-occ")
            .waitForDisplayed({ timeoutMsg: "the picture was not in the review" });
        expect(await browser.$(".fs-exam-item.is-open").getText()).not.toContain("fs-occlusion");
        await browser.execute(() => {
            document.querySelector(".fs-exam-item.is-open")?.scrollIntoView({ block: "center" });
        });
        await screenshot("exam-occlusion", true);
    });

    it("an exam file is history: read as a note it has no cards, and it is never written to", async function () {
        await openSetup();
        await setNumber("fs-exam-count", 2);
        await browser.execute(() => {
            const input = document.querySelector<HTMLInputElement>("#fs-exam-title");
            if (input === null) throw new Error("no title field");
            input.value = "Exam A::B";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await pressStart();
        await answerCurrent(true);
        await goNext();
        await answerCurrent(false);
        await submitFromLast();
        const file = await waitForExamFile();
        expect(file.text.split("\n")[0]).toBe("# Exam A::B");

        // "Review the cards in this note", on the file itself, finds nothing: the title is not a card
        const found = await browser.executeObsidian(
            async ({ app }, id, name, notePath) => {
                const plugin = (
                    app as unknown as {
                        plugins: {
                            plugins: Record<
                                string,
                                {
                                    dataManager: {
                                        loadNote: (file: unknown) => Promise<unknown>;
                                    };
                                }
                            >;
                        };
                    }
                ).plugins.plugins[id];
                const exam = app.vault.getFileByPath(`Flashcard Studio/Exams/${name}`);
                const note = app.vault.getFileByPath(notePath);
                return {
                    exam: exam === null ? "missing" : await plugin.dataManager.loadNote(exam),
                    note:
                        note === null
                            ? "missing"
                            : (await plugin.dataManager.loadNote(note)) !== null,
                };
            },
            pluginId,
            file.name,
            "Syntax deck.md",
        );
        expect(found.exam).toBeNull();
        // A note that is a note still loads
        expect(found.note).toBe(true);
        const after = fs.readFileSync(
            path.join(obsidianPage.getVaultPath(), EXAMS_FOLDER, file.name),
            "utf8",
        );
        expect(after).toBe(file.text);
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

        // Keep going: Enter is the exam's again, and goes on to the next question. The Home item that was clicked does
        // not keep the focus, or Enter would press it once more and ask about leaving again
        const question = await questionText();
        await browser.keys("Enter");
        await waitForOtherQuestion(question);
        expect(await counter()).toBe("2 / 2");
        expect(await browser.$(".fs-exam-dialog").isExisting()).toBe(false);

        // Finish: one right, one wrong
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
        // The newest files in the vault are the plugin's own: an exam, and a month of the review log. They are not notes
        // to make cards from, so the list must not have them
        const logFolder = "Flashcard Studio/Review log";
        await browser.executeObsidian(async ({ app }, folder) => {
            for (const dir of ["Flashcard Studio", "Flashcard Studio/Exams", folder]) {
                if (!app.vault.getFolderByPath(dir)) await app.vault.createFolder(dir);
            }
            await app.vault.create("Flashcard Studio/Exams/2099-01-01 0000 exam.md", "# Exam");
            await app.vault.create(`${folder}/2099-01 mac-1a2b.md`, "log");
        }, logFolder);
        await browser.$(`${SHELL} .fs-desktop-nav-item[aria-label="Create with AI"]`).click();
        const picker = browser.$(".prompt");
        await picker.waitForDisplayed({ timeoutMsg: "the note picker was not shown" });
        expect(await browser.$(".prompt-input").getAttribute("placeholder")).toBe(
            "Choose a note to make cards from",
        );
        // The note of this spec is listed, the most recently changed first
        await browser
            .$(".prompt-results .suggestion-item")
            .waitForDisplayed({ timeoutMsg: "the picker listed no notes" });
        const first = await browser.$(".prompt-results .suggestion-item").getText();
        expect(first).toContain("Syntax deck.md");
        const listed = await browser.execute(() =>
            Array.from(document.querySelectorAll(".prompt-results .suggestion-item")).map(
                (item) => item.textContent ?? "",
            ),
        );
        expect(listed.some((name) => name.includes("Flashcard Studio/Exams"))).toBe(false);
        expect(listed.some((name) => name.includes("Review log"))).toBe(false);
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
        // The phone's Studio slides in: a click while it moves lands where the row was, on nothing
        await settle(".sr-view .fs-home-exam");
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
