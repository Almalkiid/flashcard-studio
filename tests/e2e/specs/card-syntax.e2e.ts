import { browser, expect } from "@wdio/globals";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import { obsidianPage } from "wdio-obsidian-service";

import {
    answerEasy,
    NOTE,
    openReview,
    readNote,
    SCHEDULE,
    setSettings,
    showAnswer,
    TAG,
    useNote,
    waitForPlugin,
} from "../card-syntax-helpers";

// M3b: callout cards and multi-paragraph cards (a start and an end marker).
// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.

const CALLOUT_FRONT = "What is the capital of France?";
const CALLOUT_BACK = "Paris";
const MULTI_FRONT_PARTS = ["Patterns:", "help sb (to) do", "Prompt: Can you ... a newspaper ad?"];
const MULTI_BACK_PARTS = ["Can you help me (to) write a newspaper ad?", "It is a request."];

const NOTE_TEXT = [
    TAG,
    "",
    `> [!question]- ${CALLOUT_FRONT}`,
    `> ${CALLOUT_BACK}`,
    "",
    "+++",
    "Patterns:",
    "",
    "| verb | pattern |",
    "| ---- | ------- |",
    "| help | help sb (to) do |",
    "",
    "Prompt: Can you ... a newspaper ad?",
    "?",
    "Can you help me (to) write a newspaper ad?",
    "",
    "It is a request.",
    "+++",
    "",
].join("\n");

describe("card syntax: callout cards and multi-paragraph cards", function () {
    before(waitForPlugin);

    beforeEach(async function () {
        await setSettings({
            multilineCardStartMarker: "+++",
            multilineCardEndMarker: "+++",
            dailyLimitsEnabled: false,
            flashcardCardOrder: "NewFirstSequential",
            flashcardTags: [TAG],
        });
        await useNote(NOTE_TEXT);
    });

    afterEach(async function () {
        await browser.keys("Escape");
    });

    after(async function () {
        await setSettings({
            multilineCardStartMarker: "",
            multilineCardEndMarker: "",
            flashcardTags: ["#flashcards"],
        });
        await obsidianPage.resetVault();
    });

    it("reviews both cards, writes each schedule where it belongs, and finds the same cards again", async function () {
        expect(readNote()).not.toContain("<!--SR:");

        await openReview();

        // The callout card comes first: title is the front, body is the back
        const first = await showAnswer();
        expect(first.front).toContain(CALLOUT_FRONT);
        expect(first.front).not.toContain(CALLOUT_BACK);
        expect(first.withBack).toContain(CALLOUT_BACK);
        await answerEasy();

        // Then the multi-paragraph card, with its table and blank lines on both sides
        const second = await showAnswer();
        for (const part of MULTI_FRONT_PARTS) expect(second.front).toContain(part);
        expect(second.front).not.toContain(MULTI_BACK_PARTS[0]);
        for (const part of MULTI_BACK_PARTS) expect(second.withBack).toContain(part);
        await answerEasy();

        await browser.waitUntil(() => (readNote().match(/<!--SR:/g) ?? []).length === 2, {
            timeoutMsg: "the note never got both schedule comments",
        });
        const written = readNote();

        // The callout card's schedule is on the line after the callout, outside of it. The multi-paragraph
        // card's schedule is the last line of its region, before the end marker.
        expect(written).toMatch(
            new RegExp(
                `^${TAG}\\n\\n> \\[!question\\]- ${CALLOUT_FRONT.replace("?", "\\?")}\\n> ${CALLOUT_BACK}\\n${SCHEDULE}\\n\\n\\+\\+\\+\\nPatterns:\\n[\\s\\S]*\\nIt is a request\\.\\n${SCHEDULE}\\n\\+\\+\\+\\n$`,
            ),
        );
        // Nothing else in the note was touched: without the two schedule lines it is the note we wrote
        expect(written.replace(new RegExp(`${SCHEDULE}\\n`, "g"), "")).toBe(NOTE_TEXT);

        // Reopening finds nothing due: both cards are the cards they were, and both are scheduled
        await browser.keys("Escape");
        await openReview();
        await browser.pause(1500);
        // (The button stays in the DOM, hidden, when there is no card to show)
        expect(
            await browser.$(".sr-view .sr-card-container .sr-show-answer-button").isDisplayed(),
        ).toBe(false);
        expect(readNote()).toBe(written);

        // Make both schedules overdue: the same two cards come back, still with their own schedules
        await browser.keys("Escape");
        const overdue = written.replace(
            /(<!--SR:!fsrs,)[^,]+,/g,
            (_match, prefix: string) => `${prefix}2020-01-01T00:00:00.000Z,`,
        );
        expect(overdue).not.toBe(written);
        await obsidianPage.write(NOTE, overdue);
        await browser.pause(500);
        await openReview();

        const again1 = await showAnswer();
        expect(again1.front).toContain(CALLOUT_FRONT);
        expect(again1.withBack).toContain(CALLOUT_BACK);
        await answerEasy();
        const again2 = await showAnswer();
        for (const part of MULTI_FRONT_PARTS) expect(again2.front).toContain(part);
        await answerEasy();

        // Answering again replaced each schedule instead of adding another
        await browser.waitUntil(() => !readNote().includes("2020-01-01"), {
            timeoutMsg: "the overdue schedules were never rewritten",
        });
        expect((readNote().match(/<!--SR:/g) ?? []).length).toEqual(2);
    });

    it("a callout card is found without any marker, also when the regions are off", async function () {
        await setSettings({ multilineCardStartMarker: "", multilineCardEndMarker: "" });
        await useNote(`${TAG}\n\n> [!card] Front\n> Back\n`);

        await openReview();
        const card = await showAnswer();

        expect(card.front).toContain("Front");
        expect(card.withBack).toContain("Back");
        await answerEasy();
        await browser.waitUntil(() => readNote().includes("<!--SR:"), {
            timeoutMsg: "no schedule was written",
        });
        expect(readNote()).toMatch(new RegExp(`> Back\\n${SCHEDULE}\\n$`));
    });
});
