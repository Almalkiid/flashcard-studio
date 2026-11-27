import { positionsForEdit } from "src/data/segment-binding";
import { StudioSettings } from "src/data/settings-model";
import { postponeInText } from "src/scheduling/postpone";
import { unsuspendCards } from "src/scheduling/suspended-cards";

import { load, settingsWith, setUp } from "../storage/helpers";

const BLOCK = (...masks: string[]) =>
    ["```image-cloze", "image: x.png", ...masks, "```"].join("\n");

async function loaded(body: string, changes: Partial<StudioSettings> = {}) {
    const settings = settingsWith({ flashcardTags: ["#deck"], ...changes });
    setUp(settings);
    const { vault, note } = await load(`#deck\n\n${body}\n`, settings);
    return { vault, note, settings, question: note.questionList[0] };
}

describe("unsuspend by card number", () => {
    test("[c=1,c=2,c=5] with cards 1 and 5: unsuspending card 5 changes only c=5", async () => {
        const comment =
            "<!--SR:!2026-12-01,3,250,c=1,susp!2026-12-02,3,250,c=2,susp!2026-12-05,3,250,c=5,susp-->";
        const { vault, question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 5 | m rect 0 0 .1 .1 |")}\n${comment}`,
        );
        expect(question.cards.map((card) => card.meta.cardNumber)).toEqual([1, 5]);

        const result = await unsuspendCards([question.cards[1]], settings);

        expect(result).toEqual({ done: 1, failed: 0 });
        const text = vault.texts.get("N.md") ?? "";
        expect(text).toContain("2026-12-05,3,250,c=5-->");
        expect(text).toContain("2026-12-02,3,250,c=2,susp");
        expect(text).toContain("2026-12-01,3,250,c=1,susp");
    });

    test("an unnumbered comment with an empty segment: card 2 is the segment after it", async () => {
        const comment = "<!--SR:!2026-12-01,3,250!!2026-12-02,3,250,susp-->";
        const { vault, question, settings } = await loaded(
            `==1;;a== ==2;;b==\n${BLOCK("mask: 3 | m rect 0 0 .1 .1 |")}\n${comment}`,
        );
        expect(question.cards[1].meta.suspended).toBe(true);

        expect(await unsuspendCards([question.cards[1]], settings)).toEqual({ done: 1, failed: 0 });
        expect(vault.texts.get("N.md")).toContain("<!--SR:!2026-12-01,3,250!!2026-12-02,3,250-->");
    });

    test("an old math comment read again: card 1 is changed where it was loaded from", async () => {
        const patterns = ["==[123;;]answer[;;hint]==", "{{[123;;]answer[;;hint]}}"];
        const comment = "<!--SR:!2026-12-01,3,250!2026-12-02,3,250,susp-->";
        const { vault, question, settings } = await loaded(
            `$\\frac{{b}}{c}$ {{a}}\n${BLOCK("mask: 2 | m rect 0 0 .1 .1 |")}\n${comment}`,
            { latexClozes: true, clozePatterns: patterns },
        );
        // The one text card is the old second card: it loaded the suspended segment
        expect(question.cards[0].meta.suspended).toBe(true);

        expect(await unsuspendCards([question.cards[0]], settings)).toEqual({ done: 1, failed: 0 });
        expect(vault.texts.get("N.md")).toContain("<!--SR:!2026-12-01,3,250!2026-12-02,3,250-->");
    });

    test("a card with no segment: nothing changes", async () => {
        const comment = "<!--SR:!2026-12-01,3,250,c=1,susp-->";
        const { vault, question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 2 | m rect 0 0 .1 .1 |")}\n${comment}`,
        );
        const before = vault.texts.get("N.md");

        expect(await unsuspendCards([question.cards[1]], settings)).toEqual({ done: 1, failed: 0 });
        expect(vault.texts.get("N.md")).toBe(before);
    });

    test("an unreadable comment: nothing changes, counted as failed", async () => {
        const { question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 1 | m rect 0 0 .1 .1 |")}`,
        );
        const malformed = `${question.questionText.original}\n<!--SR:!2026-12-01,3,250,c=x,susp-->`;
        expect(positionsForEdit(malformed, question, [{ cardIdx: 0 }], settings)).toBe(
            "unreadable",
        );
    });
});

describe("the text at the moment of the edit decides", () => {
    test("after an answer rewrote the comment in card order, and after an undo put it back", async () => {
        const handOrder = "<!--SR:!2026-12-05,3,250,c=5,susp!2026-12-01,3,250,c=1,susp-->";
        const { question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 5 | m rect 0 0 .1 .1 |")}\n${handOrder}`,
        );
        const card5 = [question.cards[1]];
        expect(question.cards[1].meta.cardNumber).toBe(5);

        const answered = question.questionText.original.replace(
            handOrder,
            "<!--SR:!2026-12-01,3,250,c=1,susp!2026-12-09,9,250,c=5,susp-->",
        );
        expect(positionsForEdit(answered, question, card5, settings)).toEqual(new Set([1]));
        // Undo: the text before the answer, where card 5 is the first segment
        expect(positionsForEdit(question.questionText.original, question, card5, settings)).toEqual(
            new Set([0]),
        );
    });
});

describe("postpone by card number", () => {
    test("postponing card 5 moves only the c=5 segment", async () => {
        const comment = "<!--SR:!2026-10-01,3,250,c=1!2026-10-01,3,250,c=2!2026-10-01,3,250,c=5-->";
        const { question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 5 | m rect 0 0 .1 .1 |")}\n${comment}`,
        );
        const text = question.questionText.original;
        const positions = positionsForEdit(text, question, [question.cards[1]], settings);
        if (positions === "unreadable") throw new Error("unreadable");

        const result = postponeInText(
            text,
            { todayStartMs: Date.parse("2026-10-12"), days: 2 },
            positions,
        );

        expect(result.count).toBe(1);
        const segments = /<!--SR:(.+?)-->/.exec(result.text)?.[1].split("!").slice(1) ?? [];
        expect(segments[0]).toBe("2026-10-01,3,250,c=1");
        expect(segments[1]).toBe("2026-10-01,3,250,c=2");
        expect(segments[2]).not.toBe("2026-10-01,3,250,c=5");
        expect(segments[2]).toContain("c=5");
    });
});
