import { moveCommentsIntoCalloutsCounting } from "src/data/data-store/notes/vault-file-modifier";

import { Files } from "./files";

// The final review of the whole branch: "Delete scheduling data" and the callout migration touch only what they must.

const comment = "<!--SR:!2026-10-20,12,260-->";

describe("delete scheduling data writes only the notes it changes", () => {
    test("a note without sr keys in its frontmatter is not opened by the frontmatter editor", async () => {
        const files = new Files(
            { "a.md": "x\n", "b.md": "y\n" },
            { "b.md": { "sr-due": "2026-10-20" } },
        );
        const edit = jest.spyOn(files.fileManager, "processFrontMatter");
        await files.modifier.deleteAllSchedulingDataInNotes(false, []);
        expect(edit.mock.calls.map(([file]) => (file as { path: string }).path)).toEqual(["b.md"]);
        expect(files.frontmatter.get("b.md")).toEqual({});
    });

    test("frontmatter tags are only rewritten in a note that has one of the tags", async () => {
        const files = new Files(
            { "a.md": "x\n", "b.md": "y\n" },
            { "a.md": { tags: ["other"] }, "b.md": { tags: ["flashcards/x", "keep"] } },
        );
        const edit = jest.spyOn(files.fileManager, "processFrontMatter");
        await files.modifier.deleteAllSchedulingDataInCards(true, ["#flashcards"]);
        expect(edit.mock.calls.map(([file]) => (file as { path: string }).path)).toEqual(["b.md"]);
        expect(files.frontmatter.get("b.md")).toEqual({ tags: ["keep"] });
    });

    test("only the note with a comment is written, with tags asked for or not", async () => {
        const files = new Files({
            "a.md": "plain\n",
            "b.md": `Q::A\n${comment}\n`,
            "c.md": "#x\n",
        });
        await files.modifier.deleteAllSchedulingDataInCards(true, ["#flashcards"]);
        expect(files.writes).toEqual(["b.md"]);
        files.writes.length = 0;
        await files.modifier.deleteAllSchedulingDataInCards(false, []);
        expect(files.writes).toEqual([]);
    });

    test("a note whose tag is removed is written once for it", async () => {
        const files = new Files({ "a.md": "#flashcards\nQ::A\n", "b.md": "#other\n" });
        await files.modifier.deleteAllSchedulingDataInCards(true, ["#flashcards"]);
        expect(files.writes).toEqual(["a.md"]);
    });
});

describe("removing tags from the text", () => {
    const run = async (text: string, tags: string[]) => {
        const files = new Files({ "n.md": text });
        await files.modifier.removeTagsFromFile(files.vault, files.tfile("n.md"), tags);
        return files.texts.get("n.md");
    };

    test("a tag inside a word, a link address or an email is not a tag", async () => {
        expect(
            await run("see a#flashcards and x/#flashcards and #flashcards ok\n", ["#flashcards"]),
        ).toBe("see a#flashcards and x/#flashcards and  ok\n");
    });

    test("a tag at the start of a line and after a tab is removed", async () => {
        expect(await run("#flashcards\n\t#flashcards/x here\n", ["#flashcards"])).toBe(
            "\n\t here\n",
        );
    });

    test("a tag in fenced code stays, in backtick and tilde fences", async () => {
        const text =
            "#flashcards\n```\n#flashcards in code\n```\n~~~js\n#flashcards\n~~~\n#flashcards after\n";
        expect(await run(text, ["#flashcards"])).toBe(
            "\n```\n#flashcards in code\n```\n~~~js\n#flashcards\n~~~\n after\n",
        );
    });

    test("a fence closes only with a fence of its own kind that is long enough", async () => {
        const text = "````\n```\n#flashcards\n````\n#flashcards\n";
        expect(await run(text, ["#flashcards"])).toBe("````\n```\n#flashcards\n````\n\n");
    });

    test("line endings stay as they are", async () => {
        expect(await run("#flashcards\r\nQ::A\r\n", ["#flashcards"])).toBe("\r\nQ::A\r\n");
    });
});

describe("moving comments into callouts", () => {
    const run = (text: string) => moveCommentsIntoCalloutsCounting(text);

    test("a comment in fenced code is not touched", () => {
        const text = `\`\`\`\nQ::A ${comment}\n\`\`\`\n`;
        expect(run(text)).toEqual({ text, skipped: 0 });
    });

    test("a comment on a table row stays when the table goes on, and is counted", () => {
        const text = `| a | b |\n|---|---|\n| 1 | 2 | ${comment}\n| 3 | 4 |\n`;
        expect(run(text)).toEqual({ text, skipped: 1 });
    });

    test("a comment on the last row of a table is moved after the table", () => {
        const text = `| a | b |\n|---|---|\n| 1 | 2 | ${comment}\n\nnext\n`;
        expect(run(text).text).toBe(
            `| a | b |\n|---|---|\n| 1 | 2 |\n> [!sr|card-metadata]\n> ${comment}\n\nnext\n`,
        );
        expect(run(text).skipped).toBe(0);
    });

    test("a comment on a list item stays when the list goes on", () => {
        const text = `- Q::A ${comment}\n- Q2::A2\n`;
        expect(run(text)).toEqual({ text, skipped: 1 });
    });

    test("a comment line between two list items stays", () => {
        const text = `- Q::A\n${comment}\n- Q2::A2\n`;
        expect(run(text)).toEqual({ text, skipped: 1 });
    });

    test("a comment on an item that goes on with an indented line stays", () => {
        const text = `1. Q::A ${comment}\n   more\n`;
        expect(run(text)).toEqual({ text, skipped: 1 });
    });

    test("an ordinary card is moved as before, and a second run changes nothing", () => {
        const once = run(`Q::A ${comment}\nR::S\n`);
        expect(once.text).toBe(`Q::A\n> [!sr|card-metadata]\n> ${comment}\nR::S\n`);
        expect(run(once.text)).toEqual({ text: once.text, skipped: 0 });
    });
});
