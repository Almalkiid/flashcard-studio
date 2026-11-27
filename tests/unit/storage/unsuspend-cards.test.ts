import { unsuspendCards } from "src/scheduling/suspended-cards";

import { load, settingsWith, setUp } from "./helpers";

const REGION = {
    flashcardTags: ["#syntax"],
    multilineCardStartMarker: "+++",
    multilineCardEndMarker: "+++",
};

describe("unsuspendCards", () => {
    test("a card never reviewed in a region keeps the region's later schedule comment (review finding)", async () => {
        const settings = settingsWith(REGION);
        setUp(settings);
        const input =
            "#syntax\n\n+++\nQ1\n?\nA1\n<!--SR:!2000-01-01,1,250,id=aaaaaa,susp-->\n\nmore text\n<!--SR:!2026-12-01,3,250,id=bbbbbb,susp-->\n+++\n";
        const { vault, note } = await load(input, settings);

        const result = await unsuspendCards([note.questionList[0].cards[0]], settings);

        expect(result).toEqual({ done: 1, failed: 0 });
        expect(vault.texts.get("N.md")).toBe(
            "#syntax\n\n+++\nQ1\n?\nA1\n<!--SR:!2000-01-01,1,250,id=aaaaaa-->\n\nmore text\n<!--SR:!2026-12-01,3,250,id=bbbbbb,susp-->\n+++\n",
        );
    });

    test("two cards of one question are written in one go", async () => {
        const settings = settingsWith({ flashcardTags: ["#syntax"] });
        setUp(settings);
        const input =
            "#syntax\n\nQ ==a== and ==b==\n<!--SR:!2026-12-01,3,250,id=aaaaaa,susp!2026-12-02,4,250,id=bbbbbb,susp-->\n";
        const { vault, note } = await load(input, settings);
        const edits = jest.spyOn(note.questionList[0].note.file, "edit");

        const result = await unsuspendCards(note.questionList[0].cards, settings);

        expect(result).toEqual({ done: 2, failed: 0 });
        expect(edits).toHaveBeenCalledTimes(1);
        expect(vault.texts.get("N.md")).not.toContain("susp");
    });

    test("a write that throws counts as failed and does not stop the others (review finding)", async () => {
        const settings = settingsWith({ flashcardTags: ["#syntax"] });
        setUp(settings);
        const first = await load(
            "#syntax\n\nA::1 <!--SR:!2026-12-01,3,250,id=aaaaaa,susp-->\n",
            settings,
            [],
            "A.md",
        );
        const second = await load(
            "#syntax\n\nB::2 <!--SR:!2026-12-01,3,250,id=bbbbbb,susp-->\n",
            settings,
            [],
            "B.md",
        );
        jest.spyOn(first.note.questionList[0].note.file, "edit").mockRejectedValue(
            new Error("disk full"),
        );
        const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const result = await unsuspendCards(
            [first.note.questionList[0].cards[0], second.note.questionList[0].cards[0]],
            settings,
        );

        expect(result).toEqual({ done: 1, failed: 1 });
        expect(first.vault.texts.get("A.md")).toContain(",susp");
        expect(second.vault.texts.get("B.md")).not.toContain("susp");
        error.mockRestore();
    });
});
