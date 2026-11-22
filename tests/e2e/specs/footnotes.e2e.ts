import { browser, expect } from "@wdio/globals";
import { afterEach, before, beforeEach, describe, it } from "mocha";

import {
    answerEasy,
    cardText,
    openReview,
    setSettings,
    TAG,
    useNote,
    waitForPlugin,
} from "../card-syntax-helpers";

// Footnotes in cards (issue #21): the definition is elsewhere in the note, and the card still draws the citation as a
// footnote with its text listed under the card, not a plain "1" run into the text.
// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.

const NOTE = [
    TAG,
    "",
    "Te lo pido por ==favor== amigo[^1]",
    "",
    "Who wrote it[^src]?::The board",
    "",
    "[^1]: Hola",
    "[^src]: The 2024 standards",
    "",
].join("\n");

/** The card's citations as drawn, and the text of the footnote list under it. */
async function footnotes(): Promise<{ citations: string[]; list: string }> {
    return browser.execute(() => {
        const content = document.querySelector(".fs-view .fs-card-container .fs-content");
        return {
            citations: Array.from(content?.querySelectorAll("sup.footnote-ref") ?? []).map((el) =>
                (el as HTMLElement).innerText.trim(),
            ),
            list: Array.from(content?.querySelectorAll("section.footnotes") ?? [])
                .map((el) => (el as HTMLElement).innerText.trim())
                .join(" | "),
        };
    });
}

describe("footnotes in cards", function () {
    before(waitForPlugin);

    beforeEach(async function () {
        await setSettings({
            dailyLimitsEnabled: false,
            flashcardCardOrder: "NewFirstSequential",
            flashcardTags: [TAG],
            learnAheadMinutes: 0,
        });
        await useNote(NOTE);
    });

    afterEach(async function () {
        await browser.keys("Escape");
        await browser.pause(300);
    });

    for (const look of ["studio", "classic"]) {
        it(`draws a footnote defined elsewhere in the note, in the ${look} look`, async function () {
            await setSettings({ reviewLook: look });
            await openReview();
            const button = browser.$(".fs-view .fs-card-container .fs-show-answer-button");
            await button.waitForClickable({ timeoutMsg: "card front not shown" });

            // A cloze: the citation and its text on the front, and again with the answer
            expect(await footnotes()).toEqual({
                citations: ["[1]"],
                list: expect.stringContaining("Hola"),
            });
            await button.click();
            await browser.$(".fs-view .fs-card-container .fs-easy-button").waitForClickable();
            expect(await footnotes()).toEqual({
                citations: ["[1]"],
                list: expect.stringContaining("Hola"),
            });
            await answerEasy();

            // An ordinary card with the footnote in its question
            await browser.waitUntil(async () => (await cardText()).includes("Who wrote it"), {
                timeoutMsg: "second card not shown",
            });
            const front = await footnotes();
            expect(front.citations).toEqual(["[1]"]);
            expect(front.list).toContain("The 2024 standards");
            expect(front.list).not.toContain("Hola");
        });
    }
});
