import {
    ankiTagToObsidianTag,
    appendToDeckNote,
    deckLevels,
    deckNotePath,
    deckTag,
    formatDeckNote,
    joinPath,
    sanitizeFileName,
    tagLine,
} from "src/import-export/deck-note";
import {
    decodeGuid,
    encodeGuid,
    findGuids,
    formatGuidComment,
    syntheticGuid,
} from "src/import-export/guid-comment";

describe("guid comments", () => {
    test("encode guids so that they cannot end the comment", () => {
        const guid = "a-->b<c>-d.e";
        const encoded = encodeGuid(guid);
        expect(encoded).not.toMatch(/[-<>.]/);
        expect(decodeGuid(encoded)).toBe(guid);
    });

    test("round trip every character Anki uses in guids", () => {
        const alphabet =
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";
        expect(decodeGuid(encodeGuid(alphabet))).toBe(alphabet);
        expect(encodeGuid(alphabet)).not.toContain("-->");
    });

    test("decodes a broken encoding as it is", () => {
        expect(decodeGuid("100%")).toBe("100%");
    });

    test("finds the guids in a note's text", () => {
        const text = `#flashcards\n\nQ\n?\nA\n${formatGuidComment("i>WU5liws]")}\n\nB::C\n${formatGuidComment("x-->y")}\n<!--not anki-->`;
        expect(findGuids(text)).toEqual(["i>WU5liws]", "x-->y"]);
        expect(findGuids("no comments")).toEqual([]);
    });

    test("make the same synthetic guid for the same deck and first field", () => {
        expect(syntheticGuid("Deck", "front")).toBe(syntheticGuid("Deck", "front"));
        expect(syntheticGuid("Deck", "front")).not.toBe(syntheticGuid("Other", "front"));
        expect(syntheticGuid("Deck", "front")).toMatch(/^csv-/);
    });
});

describe("paths", () => {
    test("sanitizeFileName replaces what a file name or link cannot have", () => {
        expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j#k^l[m]n')).toBe(
            "a-b-c-d-e-f-g-h-i-j-k-l-m-n",
        );
        expect(sanitizeFileName("  Unit 01 (Gemini)  ")).toBe("Unit 01 (Gemini)");
        expect(sanitizeFileName("..hidden.")).toBe("_hidden");
        expect(sanitizeFileName("")).toBe("Untitled");
        expect(sanitizeFileName("x".repeat(300))).toHaveLength(100);
    });

    test("joinPath drops empty parts and doubled slashes", () => {
        expect(joinPath("A/", "/B", "", "C/D")).toBe("A/B/C/D");
    });

    test("deckLevels splits on ::", () => {
        expect(deckLevels("A::B :: C")).toEqual(["A", "B", "C"]);
        expect(deckLevels("::")).toEqual([]);
    });

    test("deckNotePath puts a deck's note in a folder path that is the deck path", () => {
        expect(deckNotePath("Flashcards/Imported", "CIA Part 1::Unit 01 (Gemini)")).toBe(
            "Flashcards/Imported/CIA Part 1/Unit 01 (Gemini)/Unit 01 (Gemini).md",
        );
        expect(deckNotePath("Target", "Spanish")).toBe("Target/Spanish/Spanish.md");
        expect(deckNotePath("Target", "A/B::C?")).toBe("Target/A-B/C-/C-.md");
        expect(deckNotePath("Target", "")).toBe("Target/Default/Default.md");
    });
});

describe("tags", () => {
    test.each([
        ["leech", "leech"],
        ["grammar::verbs::regular", "grammar/verbs/regular"],
        ["AnKing_Step1::#UWorld::Step 1", "AnKing_Step1/UWorld/Step-1"],
        ["café", "café"],
        ["2024", "_2024"],
        ["2024::12", "_2024/12"],
        ["a b", "a-b"],
        ["!!!", null],
        ["", null],
    ])("ankiTagToObsidianTag(%p) is %p", (tag, expected) => {
        expect(ankiTagToObsidianTag(tag)).toBe(expected);
    });

    test("deckTag makes the deck's path a tag path", () => {
        expect(deckTag("#flashcards", "CIA Part 1::Unit 01 (Gemini)")).toBe(
            "#flashcards/CIA-Part-1/Unit-01-Gemini",
        );
        expect(deckTag("#flashcards", "")).toBe("#flashcards");
        expect(deckTag("#cards", "A::B")).toBe("#cards/A/B");
    });

    test("tagLine puts the deck tag first, then the Anki tags", () => {
        expect(tagLine("#flashcards", "Spanish", ["a", "b/c"])).toBe("#flashcards/Spanish #a #b/c");
    });
});

describe("deck notes", () => {
    const cards = [
        { markdown: "Q\n?\nA", guid: "g1" },
        { markdown: "B::C", guid: "g-2" },
    ];

    test("formatDeckNote writes the tag line, then each card followed by its guid comment", () => {
        expect(formatDeckNote("#flashcards/Spanish", cards)).toBe(
            "#flashcards/Spanish\n\nQ\n?\nA\n<!--anki:g1-->\n\nB::C\n<!--anki:g%2D2-->\n",
        );
    });

    test("appendToDeckNote adds cards after the existing text, and tags it does not have to the tag line", () => {
        const existing = "#flashcards/Spanish #a\n\nOld::card\n<!--anki:old-->\n\n";
        expect(appendToDeckNote(existing, [cards[0]], ["a", "b"])).toBe(
            "#flashcards/Spanish #a #b\n\nOld::card\n<!--anki:old-->\n\nQ\n?\nA\n<!--anki:g1-->\n",
        );
    });

    test("appendToDeckNote leaves a first line that is not a tag line alone", () => {
        expect(appendToDeckNote("My own notes\n", [cards[1]], ["x"])).toBe(
            "My own notes\n\nB::C\n<!--anki:g%2D2-->\n",
        );
    });
});
