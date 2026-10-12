import { Files } from "./files";
import { golden } from "./helpers";

interface Golden {
    removeSchedulesInCards: { id: string; input: string; output: string }[];
    removeTagsFromFile: {
        id: string;
        tagsToDelete: string[];
        tagsArrayAfterCall: string[];
        input: string;
        frontmatterBefore: Record<string, unknown>;
        frontmatterAfter: Record<string, unknown>;
        output: string;
        error?: string;
    }[];
    noteLevel: { id: string }[];
    migrateCommentsToCallouts: {
        id: string;
        input: string;
        output: string;
        outputAfterSecondRun: string;
    }[];
}

const data = golden<Golden>("file-modifier");

const quoted = "> [!sr|card-metadata]";
const comment = "<!--SR:!2026-10-20,12,260-->";
// Rows whose result changed on purpose, pinned to the corrected value
const CHANGED = {
    // fix 5: a line ending of two characters is removed with the comment as one
    removeSchedulesInCards: { "rs-crlf": "Q::A\r\nR::S\r\n" } as Record<string, string>,
    // fix 4: a tag is a whole tag (a longer tag that starts the same stays), is searched as text, and the list of tags
    // the caller gave is not reordered
    removeTagsFromFile: {
        "rt-prefix-collision": { output: "#flashcards-extra Q::A\n#flashcards2\n" },
        "rt-special-char-in-tag": { output: " and #c\n", error: undefined },
        "rt-order-by-length": { tags: ["#flash", "#flashcards"] },
    } as Record<string, Record<string, unknown>>,
    // fix 2: only the comment moves, into a callout under its line, and a comment already in a quote stays; every line
    // keeps its own ending
    migrateCommentsToCallouts: {
        "mg-same-line": {
            output: `Q::A\n${quoted}\n> <!--SR:!2026-10-20,12,260,id=abc123-->\nR::S`,
        },
        "mg-same-line-blockid": {
            output: `Q::A ^b1\n${quoted}\n> <!--SR:!2026-10-20,12,260,id=abc123-->\nR::S`,
        },
        "mg-callout-no-space": { output: `Q::A\n${quoted}\n><!--SR:!2026-10-20,12,260-->\n` },
        "mg-first-line": { output: `${quoted}\n> ${comment}\nQ::A` },
        "mg-quote-prefix-other": { output: `>> ${comment}\n` },
        "mg-indented": { output: `Q::A\n${quoted}\n>    ${comment}\n` },
        "mg-crlf": { output: `Q::A\r\n${quoted}\r\n> ${comment}\r\nR::S\r\n` },
        "mg-comment-only-note": { output: `${quoted}\n> ${comment}` },
        "mg-two-on-line": {
            output: `A B\n${quoted}\n> ${comment}\n> <!--SR:!2026-10-21,5,250-->\n`,
        },
    } as Record<string, { output: string }>,
};

describe.each(data.removeSchedulesInCards)("card schedules removed: $id", (row) => {
    test("the note text afterwards", async () => {
        const files = new Files({ "n.md": row.input });
        await files.modifier.removeSchedulingInfoInCards(
            files.vault,
            files.tfile("n.md"),
            false,
            [],
        );
        expect(files.texts.get("n.md")).toBe(CHANGED.removeSchedulesInCards[row.id] ?? row.output);
    });
});

describe.each(data.removeTagsFromFile)("tags removed: $id", (row) => {
    test("the body, the frontmatter, the tag list and the error", async () => {
        const files = new Files({ "n.md": row.input }, { "n.md": row.frontmatterBefore });
        const tags = [...row.tagsToDelete];
        let error: string | undefined;
        try {
            await files.modifier.removeTagsFromFile(files.vault, files.tfile("n.md"), tags);
        } catch (e) {
            error = `${(e as Error).name}`;
        }
        const expected = {
            output: row.output,
            frontmatter: row.frontmatterAfter,
            tags: row.tagsArrayAfterCall,
            error: row.error ? "SyntaxError" : undefined,
            ...CHANGED.removeTagsFromFile[row.id],
        };
        expect({
            output: files.texts.get("n.md"),
            frontmatter: files.frontmatter.get("n.md"),
            tags,
            error,
        }).toEqual(expected);
    });
});

describe.each(data.migrateCommentsToCallouts)("comments moved into callouts: $id", (row) => {
    test("the note text, and the same after a second run", async () => {
        const files = new Files({ "n.md": row.input });
        const file = files.tfile("n.md");
        const changed = CHANGED.migrateCommentsToCallouts[row.id];
        await files.modifier.migrateCommentsToCalloutsInFile(file, files.vault);
        expect(files.texts.get("n.md")).toBe(changed?.output ?? row.output);
        await files.modifier.migrateCommentsToCalloutsInFile(file, files.vault);
        // A second run changes nothing; the golden second run is only different where the first run wrapped a quote again
        expect(files.texts.get("n.md")).toBe(changed?.output ?? row.outputAfterSecondRun);
    });
});

describe("note level", () => {
    test("rn-keys-and-tags: sr-due, sr-interval and sr-ease go, sr-id stays, tags go when asked", async () => {
        const row = data.noteLevel[0] as unknown as {
            frontmatterAfter: Record<string, unknown>;
            body: string;
        };
        const files = new Files(
            { "n.md": "Q::A" },
            {
                "n.md": {
                    "sr-due": "2026-10-20",
                    "sr-interval": 12,
                    "sr-ease": 260,
                    "sr-id": "uuid",
                    title: "t",
                    tags: ["flashcards/x", "review/y"],
                },
            },
        );
        await files.modifier.removeSchedulingInfoInNotes(files.vault, files.tfile("n.md"), true, [
            "#review",
        ]);
        expect(files.frontmatter.get("n.md")).toEqual(row.frontmatterAfter);
        expect(files.texts.get("n.md")).toBe(row.body);
    });

    test("rn-delete-all: per file the note keys and note tags, then the card comments and deck tags", async () => {
        const row = data.noteLevel[1] as unknown as {
            files: Record<string, string>;
            frontmatter: Record<string, Record<string, unknown>>;
        };
        const files = new Files(
            {
                "a.md": "#flashcards\nQ::A\n<!--SR:!2026-10-20,12,260-->",
                "b.md": "#flashcards\ntext",
            },
            {
                "a.md": { "sr-due": "2026-10-20", "sr-interval": 12, "sr-ease": 260 },
                "b.md": { tags: ["review/b", "flashcards/b"] },
            },
        );
        await files.modifier.deleteAllSchedulingData(true, ["#flashcards"], ["#review"]);
        expect(Object.fromEntries(files.texts)).toEqual(row.files);
        expect(Object.fromEntries(files.frontmatter)).toEqual(row.frontmatter);
    });
});
