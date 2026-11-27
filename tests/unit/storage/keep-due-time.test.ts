import { CommentParser } from "src/utils/schedule-comment";

import { load, scheduleFor, settingsWith, setUp } from "./helpers";

// A copy of the Spaced Repetition plugin writes due dates with a time ("2023-09-21-13-25"). Flashcard Studio reads the
// day and schedules by day; a save wrote every schedule of the question back without the time, also the ones of cards
// that were not reviewed (9 schedules in one real public note).

const settings = settingsWith({ flashcardTags: ["#flashcards"] });

describe("a due date written with a time", () => {
    test("is read as that day", () => {
        const [schedule] = CommentParser.parseMultiScheduleComment("!2023-09-21-13-25,68.9,230");
        expect(schedule?.dueDate.format("YYYY-MM-DD HH:mm")).toBe("2023-09-21 00:00");
        expect(schedule?.interval).toBe(68.9);
    });

    test("is written back as it was while the card is not reviewed", () => {
        const [schedule] = CommentParser.parseMultiScheduleComment("!2023-09-21-13-25,68.9,230");
        expect(schedule?.formatScheduleAsComment()).toBe("!2023-09-21-13-25,68.9,230");
    });

    test("a review of another card of the question keeps it; the reviewed card gets its new day", async () => {
        const text = [
            "#flashcards",
            "",
            "==one== and ==two==",
            "<!--SR:!2023-09-21-13-25,68.9,230!2024-01-26-16-08,196,250-->",
            "",
        ].join("\n");
        setUp(settings);
        const { vault, note } = await load(text, settings);
        const question = note.questionList[0];
        question.cards[0].scheduleInfo = scheduleFor({ set: "sm2", due: "2026-10-20" });
        expect(await question.writeQuestion(settings)).toBe(true);

        const saved = vault.texts.get("N.md") ?? "";
        expect(saved).toContain("!2026-10-20,12,260");
        expect(saved).toContain("!2024-01-26-16-08,196,250");
        expect(saved).not.toContain("2023-09-21");
    });
});
