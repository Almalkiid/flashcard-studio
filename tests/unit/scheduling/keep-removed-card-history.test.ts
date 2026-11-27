import { StudioSettings } from "src/data/settings-model";
import { keptHistories, removeKeptHistories } from "src/scheduling/kept-history";

import { load, settingsWith, setUp } from "../storage/helpers";

const BLOCK = (...masks: string[]) =>
    ["```image-cloze", "image: x.png", ...masks, "```"].join("\n");

async function loaded(body: string, changes: Partial<StudioSettings> = {}) {
    const settings = settingsWith({ flashcardTags: ["#deck"], ...changes });
    setUp(settings);
    const { vault, note } = await load(`#deck\n\n${body}\n`, settings);
    return { vault, note, settings, question: note.questionList[0] };
}

const C1 = "2026-12-01,3,250,c=1";
const C2 = "2026-12-02,7,230,c=2,id=abc123,flag=2";
const C5 = "2026-12-05,3,250,c=5";

describe("a removed card number keeps its history, as in Anki", () => {
    test("a write keeps the segment of a number no card uses, unchanged, after the cards' own", async () => {
        const { vault, question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 5 | m rect 0 0 .1 .1 |")}\n<!--SR:!${C1}!${C2}!${C5}-->`,
        );
        expect(question.cards.map((card) => card.meta.cardNumber)).toEqual([1, 5]);

        expect(await question.writeQuestion(settings)).toBe(true);

        // A write gives each reviewed card an id; the kept segment is written as it was, after the cards' own
        expect(vault.texts.get("N.md")).toMatch(
            new RegExp(`<!--SR:!${C1},id=\\w+!${C5},id=\\w+!${C2}-->`),
        );
    });

    test("kept segments go by number, and a later write keeps them where they are", async () => {
        const C3 = "2026-12-03,1,250,c=3";
        const { vault, question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 1 | m rect 0 0 .1 .1 |")}\n<!--SR:!${C3}!${C1}!${C2}-->`,
        );
        await question.writeQuestion(settings);
        const once = vault.texts.get("N.md") ?? "";
        expect(once).toMatch(new RegExp(`<!--SR:!${C1},id=\\w+!${C2}!${C3}-->`));

        await question.writeQuestion(settings);
        expect(vault.texts.get("N.md")).toBe(once);
    });

    test("the number used again brings the card back with its history", async () => {
        const { vault, question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 5 | m rect 0 0 .1 .1 |")}\n<!--SR:!${C1}!${C2}!${C5}-->`,
        );
        await question.writeQuestion(settings);
        const text = (vault.texts.get("N.md") ?? "").replace("mask: 5 |", "mask: 2,5 |");

        const again = await loaded(text.replace(/^#deck\n\n/, "").trimEnd());

        const card2 = again.question.cards.find((card) => card.meta.cardNumber === 2);
        expect(card2?.meta.id).toBe("abc123");
        expect(card2?.meta.flag).toBe(2);
        expect(card2?.scheduleInfo?.formatScheduleAsComment()).toBe("!2026-12-02,7,230");
    });

    test("cards with no schedule yet still keep the history of a removed number", async () => {
        const { vault, question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 1 | m rect 0 0 .1 .1 |")}\n<!--SR:!${C2}-->`,
        );
        expect(question.cards.every((card) => !card.hasSchedule)).toBe(true);

        await question.writeQuestion(settings);

        expect(vault.texts.get("N.md")).toContain(C2);
    });

    test("a comment without card numbers is written by position, as before", async () => {
        const { vault, question, settings } = await loaded(
            "==a== ==b==\n<!--SR:!2026-12-01,3,250!2026-12-02,3,250!2026-12-03,3,250-->",
        );
        await question.writeQuestion(settings);
        expect(vault.texts.get("N.md")).toMatch(
            /<!--SR:!2026-12-01,3,250,id=\w+!2026-12-02,3,250,id=\w+-->/,
        );
    });
});

describe("removing the history of removed cards (Anki: Empty Cards)", () => {
    test("lists each question with kept history once, with its removed numbers", async () => {
        const { note } = await loaded(
            `==1;;a==\n${BLOCK("mask: 5 | m rect 0 0 .1 .1 |")}\n<!--SR:!${C1}!${C2}!${C5}-->`,
        );
        const [question] = note.questionList;
        expect(keptHistories(note.questionList.flatMap((q) => q.cards))).toEqual([
            { question, numbers: [2] },
        ]);
    });

    test("a question without kept history is not listed", async () => {
        const { note } = await loaded(
            `==1;;a==\n${BLOCK("mask: 2 | m rect 0 0 .1 .1 |")}\n<!--SR:!${C1}!${C2}-->`,
        );
        expect(keptHistories(note.questionList.flatMap((q) => q.cards))).toEqual([]);
    });

    test("removing drops only the kept segments; the cards' own stay", async () => {
        const { vault, question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 5 | m rect 0 0 .1 .1 |")}\n<!--SR:!${C1}!${C2}!${C5}-->`,
        );

        expect(await removeKeptHistories([question], settings)).toEqual({ done: 1, failed: 0 });

        const text = vault.texts.get("N.md") ?? "";
        expect(text).not.toContain("c=2");
        expect(text).toContain("2026-12-01,3,250,c=1");
        expect(text).toContain("2026-12-05,3,250,c=5");
        // And a later write does not bring it back
        await question.writeQuestion(settings);
        expect(vault.texts.get("N.md")).not.toContain("c=2");
    });

    test("cards never reviewed and only kept history: the comment goes", async () => {
        const { vault, question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 1 | m rect 0 0 .1 .1 |")}\n<!--SR:!${C2}-->`,
        );

        expect(await removeKeptHistories([question], settings)).toEqual({ done: 1, failed: 0 });

        expect(vault.texts.get("N.md")).not.toContain("<!--SR:");
    });

    test("a note changed since it was read: nothing is written, counted as failed", async () => {
        const { vault, question, settings } = await loaded(
            `==1;;a==\n${BLOCK("mask: 5 | m rect 0 0 .1 .1 |")}\n<!--SR:!${C1}!${C2}!${C5}-->`,
        );
        const changed = (vault.texts.get("N.md") ?? "").replace("==1;;a==", "==1;;b==");
        vault.texts.set("N.md", changed);

        expect(await removeKeptHistories([question], settings)).toEqual({ done: 0, failed: 1 });
        expect(vault.texts.get("N.md")).toBe(changed);
    });
});
