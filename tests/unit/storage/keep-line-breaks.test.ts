import { load, scheduleFor, settingsWith, setUp } from "./helpers";

// Two spaces at the end of a line are a line break in Markdown. 26 of 1,637 real public notes use them inside cards;
// a save wrote the card back from its trimmed text, so their lines ran together after a review.

const settings = settingsWith({ flashcardTags: ["#flashcards"] });

async function reviewFirstCard(text: string): Promise<string> {
    setUp(settings);
    const { vault, note } = await load(text, settings);
    const question = note.questionList[0];
    question.cards[0].scheduleInfo = scheduleFor({ set: "sm2", due: "2026-10-20" });
    expect(await question.writeQuestion(settings)).toBe(true);
    return vault.texts.get("N.md") ?? "";
}

describe("a save keeps the line breaks of a card (two spaces at the end of a line)", () => {
    test("a multi-line card: every line keeps its two spaces; only the schedule is added", async () => {
        const text = [
            "#flashcards",
            "",
            "Key characteristics?  ",
            "?",
            "- repeated under similar conditions,  ",
            "- outcomes known beforehand,  ",
            "- any single outcome uncertain",
            "",
        ].join("\n");

        const saved = await reviewFirstCard(text);

        expect(saved).toBe(text.replace(/\n$/, "\n<!--SR:!2026-10-20,12,260,id=012345-->\n"));
    });

    test("a card with a schedule already: the lines keep their spaces, the schedule changes", async () => {
        const text = [
            "#flashcards",
            "",
            "Mais les américains sont encore nombreux  ",
            "?",
            "Aber die Amerikaner sind noch zahlreich  ",
            "<!--SR:!2023-01-01,3,250-->",
            "",
        ].join("\n");

        const saved = await reviewFirstCard(text);

        expect(saved).toBe(text.replace("2023-01-01,3,250", "2026-10-20,12,260,id=012345"));
    });

    test("other trailing white space a line had is kept too, and a line that changed is written as it is now", async () => {
        const text = "#flashcards\n\nQuestion\t \n?\nAnswer   \n";
        const saved = await reviewFirstCard(text);
        expect(saved).toBe(
            "#flashcards\n\nQuestion\t \n?\nAnswer   \n<!--SR:!2026-10-20,12,260,id=012345-->\n",
        );
    });
});
