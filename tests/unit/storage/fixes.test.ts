import { DataStore, Question } from "./api";
import { Files } from "./files";
import { load, settingsWith, setUp, view } from "./helpers";

// The storage bugs of section 15 of the behaviour inventory, one block each. Every test failed before the fix.

const settings = settingsWith();

async function reviewed(text: string, ...cardsToSchedule: number[]) {
    setUp(settings);
    const loaded = await load(text, settings);
    const { Sm2State } = await import("src/scheduling/schedule/sm2-state");
    const { moment } = await import("src/utils/moment-en");
    for (const q of cardsToSchedule) {
        loaded.note.questionList[q].cards[0].scheduleInfo = new Sm2State(
            moment(`2026-11-0${q + 1}`, "YYYY-MM-DD"),
            12,
            260,
        );
    }
    return loaded;
}

const write = (question: Question) => DataStore.getInstance().writeSchedule(question);

describe("a write goes to the card it belongs to", () => {
    test("two identical cards, both reviewed: each gets its own comment", async () => {
        const { vault, note } = await reviewed("#flashcards\nQ::A\n\nQ::A", 0, 1);
        await write(note.questionList[0]);
        await write(note.questionList[1]);
        expect(vault.texts.get("N.md")).toBe(
            "#flashcards\nQ::A\n<!--SR:!2026-11-01,12,260,id=012345-->\n\nQ::A\n<!--SR:!2026-11-02,12,260,id=6789ab-->",
        );
    });

    test("only the second of two identical cards reviewed: the first stays as it was", async () => {
        const { vault, note } = await reviewed("#flashcards\nQ::A\n\nQ::A", 1);
        await write(note.questionList[1]);
        expect(vault.texts.get("N.md")).toBe(
            "#flashcards\nQ::A\n\nQ::A\n<!--SR:!2026-11-02,12,260,id=012345-->",
        );
    });

    test("a card that is the start of an earlier card does not corrupt it", async () => {
        const { vault, note } = await reviewed("#flashcards\nQ::AB\n\nQ::A", 1);
        await write(note.questionList[1]);
        expect(vault.texts.get("N.md")).toBe(
            "#flashcards\nQ::AB\n\nQ::A\n<!--SR:!2026-11-02,12,260,id=012345-->",
        );
    });

    test("a card moved by an edit elsewhere is found where it is now", async () => {
        const { vault, note } = await reviewed("#flashcards\nQ::A\nR::B", 1);
        vault.texts.set("N.md", "#flashcards\nnew line\nQ::A\nR::B");
        expect(await write(note.questionList[1])).toBe(true);
        expect(vault.texts.get("N.md")).toBe(
            "#flashcards\nnew line\nQ::A\nR::B\n<!--SR:!2026-11-02,12,260,id=012345-->",
        );
    });

    test("identical cards after a line was added above: nothing is written, as there is no telling which is meant", async () => {
        const { vault, note } = await reviewed("#flashcards\nQ::A\n\nQ::A", 1);
        const edited = "#flashcards\nnew line\nQ::A\n\nQ::A";
        vault.texts.set("N.md", edited);
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(await write(note.questionList[1])).toBe(false);
        expect(vault.texts.get("N.md")).toBe(edited);
        warn.mockRestore();
    });

    test("a question given a text of another length (an undone answer) moves the cards after it", async () => {
        const { vault, note } = await reviewed("#flashcards\nQ::A\nR::B\n\nR::B", 0);
        await write(note.questionList[0]);
        expect(vault.texts.get("N.md")).toBe(
            "#flashcards\nQ::A\n<!--SR:!2026-11-01,12,260,id=012345-->\nR::B\n\nR::B",
        );
        // The undo: the note text goes back, and the question takes its old text
        vault.texts.set("N.md", "#flashcards\nQ::A\nR::B\n\nR::B");
        const { QuestionText } = await import("./api");
        const first = note.questionList[0];
        first.questionText = QuestionText.create(
            "Q::A",
            first.questionText.textDirection,
            settings,
        );
        const second = note.questionList[2];
        second.cards[0].scheduleInfo = note.questionList[0].cards[0].scheduleInfo;
        expect(await write(second)).toBe(true);
        expect(vault.texts.get("N.md")).toBe(
            "#flashcards\nQ::A\nR::B\n\nR::B\n<!--SR:!2026-11-01,12,260,id=6789ab-->",
        );
    });

    test("a write moves the cards after it: the next card of the note is still found", async () => {
        const { vault, note } = await reviewed("#flashcards\nQ::A\nR::B\nS::C", 0, 1, 2);
        for (const question of note.questionList) await write(question);
        expect(vault.texts.get("N.md")).toBe(
            "#flashcards\nQ::A\n<!--SR:!2026-11-01,12,260,id=012345-->\nR::B\n<!--SR:!2026-11-02,12,260,id=6789ab-->\nS::C\n<!--SR:!2026-11-03,12,260,id=cdefgh-->",
        );
    });

    test("a note with Windows line endings keeps them", async () => {
        const { vault, note } = await reviewed("#flashcards\r\nQ\r\n?\r\nA\r\n\r\nB::2\r\n", 0);
        await write(note.questionList[0]);
        expect(vault.texts.get("N.md")).toBe(
            "#flashcards\r\nQ\r\n?\r\nA\r\n<!--SR:!2026-11-01,12,260,id=012345-->\r\n\r\nB::2\r\n",
        );
    });

    test("the loaded note says where each card is after several writes", async () => {
        const { vault, note } = await reviewed("#flashcards\nQ::A\nR::B", 0, 1);
        await write(note.questionList[0]);
        await write(note.questionList[1]);
        setUp(settings);
        const again = await load(vault.texts.get("N.md"), settings);
        expect(view(again.note).map((q) => q.cards[0].schedule)).toEqual([
            "!2026-11-01,12,260",
            "!2026-11-02,12,260",
        ]);
    });
});

describe("deleting a card", () => {
    test("the second of two identical cards goes, not the first", async () => {
        setUp(settings);
        const { vault, note } = await load("#flashcards\nA::1\n\nA::1\nB::2", settings, ["Root"]);
        await DataStore.getInstance().delete(note.questionList[1]);
        expect(vault.texts.get("N.md")).toBe("#flashcards\nA::1\n\n\nB::2");
    });

    test("a multi-line card right under the tag line leaves the tag line", async () => {
        setUp(settings);
        const { vault, note } = await load("#flashcards\nQ\n?\nA\n\nB::2\n", settings);
        await DataStore.getInstance().delete(note.questionList[0]);
        expect(vault.texts.get("N.md")).toBe("#flashcards\n\n\nB::2\n");
    });

    test("a cloze card right under the tag line leaves the tag line", async () => {
        setUp(settings);
        const { vault, note } = await load("#flashcards\nA ==b== c\n\nB::2\n", settings);
        await DataStore.getInstance().delete(note.questionList[0]);
        expect(vault.texts.get("N.md")).toBe("#flashcards\n\n\nB::2\n");
    });

    test("a card with its own tag on its line goes with that tag", async () => {
        setUp(settings);
        const { vault, note } = await load("#flashcards\n#flashcards/x A::1\nB::2\n", settings);
        await DataStore.getInstance().delete(note.questionList[0]);
        expect(vault.texts.get("N.md")).toBe("#flashcards\n\nB::2\n");
    });

    test("a note with Windows line endings keeps them", async () => {
        setUp(settings);
        const { vault, note } = await load("#flashcards\r\nQ\r\n?\r\nA\r\n\r\nB::2\r\n", settings);
        await DataStore.getInstance().delete(note.questionList[0]);
        expect(vault.texts.get("N.md")).toBe("#flashcards\r\n\r\n\r\nB::2\r\n");
    });
});

describe("moving schedules into callouts", () => {
    const run = async (text: string, times = 1) => {
        const files = new Files({ "n.md": text });
        for (let i = 0; i < times; i++)
            await files.modifier.migrateCommentsToCalloutsInFile(files.tfile("n.md"), files.vault);
        return files.texts.get("n.md");
    };

    test("a comment on the line of its card moves out, and the card stays as it was", async () => {
        expect(await run("Q::A <!--SR:!2026-10-20,12,260--> ^b1\nR::S")).toBe(
            "Q::A ^b1\n> [!sr|card-metadata]\n> <!--SR:!2026-10-20,12,260-->\nR::S",
        );
    });

    test.each([
        ["a comment on its own line", "Q::A\n<!--SR:!2026-10-20,12,260-->\nR::S"],
        ["a comment on the line of its card", "Q::A <!--SR:!2026-10-20,12,260-->\nR::S"],
        ["a comment in a quote without a space", "Q::A\n><!--SR:!2026-10-20,12,260-->\n"],
        ["a comment in a deeper quote", ">> <!--SR:!2026-10-20,12,260-->\n"],
        ["an indented comment", "Q::A\n   <!--SR:!2026-10-20,12,260-->\n"],
        [
            "two comments on a line",
            "A <!--SR:!2026-10-20,12,260--> B <!--SR:!2026-10-21,5,250-->\n",
        ],
    ])("a second run changes nothing: %s", async (_, text) => {
        expect(await run(text, 2)).toBe(await run(text));
    });

    test("a comment that runs over two lines is left alone", async () => {
        const text = "Q::A <!--SR:!2026-10-20,12,\n260-->\nR::S";
        expect(await run(text)).toBe(text);
    });

    test("a note with Windows line endings keeps one ending throughout", async () => {
        expect(await run("Q::A\r\n<!--SR:!2026-10-20,12,260-->\r\nR::S\r\n")).toBe(
            "Q::A\r\n> [!sr|card-metadata]\r\n> <!--SR:!2026-10-20,12,260-->\r\nR::S\r\n",
        );
    });
});

describe("removing tags", () => {
    const run = async (text: string, tags: string[]) => {
        const files = new Files({ "n.md": text });
        await files.modifier.removeTagsFromFile(files.vault, files.tfile("n.md"), tags);
        return files.texts.get("n.md");
    };

    test("a tag with characters a pattern would read is removed as text", async () => {
        expect(await run("#c++ and #c\n", ["#c++"])).toBe(" and #c\n");
        expect(await run("#c(1) x\n", ["#c(1)"])).toBe(" x\n");
    });

    test("a longer tag that starts with the removed one stays", async () => {
        expect(
            await run("#flashcards-extra Q::A\n#flashcards2\n#flashcards/x\n#flashcards\n", [
                "#flashcards",
            ]),
        ).toBe("#flashcards-extra Q::A\n#flashcards2\n\n\n");
    });

    test("the list of tags the caller gave is left as it was", async () => {
        const tags = ["#flash", "#flashcards"];
        await run("#flash #flashcards/x\n", tags);
        expect(tags).toEqual(["#flash", "#flashcards"]);
    });

    test("removing both a tag and its longer sibling takes both", async () => {
        expect(await run("#flash #flashcards/x\n", ["#flash", "#flashcards"])).toBe(" \n");
    });
});

describe("removing card schedules", () => {
    test("a note with Windows line endings keeps its line endings", async () => {
        const files = new Files({ "n.md": "Q::A\r\n<!--SR:!2026-10-20,12,260-->\r\nR::S\r\n" });
        await files.modifier.removeSchedulingInfoInCards(
            files.vault,
            files.tfile("n.md"),
            false,
            [],
        );
        expect(files.texts.get("n.md")).toBe("Q::A\r\nR::S\r\n");
    });
});
