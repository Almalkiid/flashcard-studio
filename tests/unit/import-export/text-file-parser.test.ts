import { parseTextFile, textFileToNotes } from "src/import-export/text-file-parser";

describe("parseTextFile", () => {
    test("reads tab separated rows and guesses the separator", () => {
        const file = parseTextFile("front1\tback1\nfront2\tback2\n");
        expect(file.separator).toBe("\t");
        expect(file.rows).toEqual([
            ["front1", "back1"],
            ["front2", "back2"],
        ]);
        expect(file.html).toBe(false);
    });

    test.each([
        ["a;b\nc;d", ";"],
        ["a,b\nc,d", ","],
        ["a|b\nc|d", "|"],
        ["a:b\nc:d", ":"],
        ["a b\nc d", " "],
    ])("guesses the separator of %p", (text, separator) => {
        const file = parseTextFile(text);
        expect(file.separator).toBe(separator);
        expect(file.rows).toEqual([
            ["a", "b"],
            ["c", "d"],
        ]);
    });

    test("prefers the separator that splits every row the same way", () => {
        // Commas inside the text are not the separator: the semicolon splits both rows in two
        const file = parseTextFile("hello, world;bonjour\nyes, no;oui");
        expect(file.separator).toBe(";");
    });

    test("falls back to the separator with most fields, then to tab", () => {
        expect(parseTextFile("a,b,c\nd,e").separator).toBe(",");
        expect(parseTextFile("single\nlines").separator).toBe("\t");
        expect(parseTextFile("").rows).toEqual([]);
    });

    test("reads quoted fields with separators, doubled quotes and new lines", () => {
        const file = parseTextFile(
            'hello;"this is\na two line answer"\n"has a ; in it";"with ""quotes"" inside"\nplain;x',
        );
        expect(file.rows).toEqual([
            ["hello", "this is\na two line answer"],
            ["has a ; in it", 'with "quotes" inside'],
            ["plain", "x"],
        ]);
    });

    test("reads windows line endings and a byte order mark", () => {
        const file = parseTextFile("\uFEFFa\tb\r\nc\td\r\n");
        expect(file.rows).toEqual([
            ["a", "b"],
            ["c", "d"],
        ]);
    });

    test("skips comment lines and empty lines", () => {
        const file = parseTextFile(
            "# a comment\nfoo bar;bar baz;baz quux\n\n# another\nfield1;field2;field3",
        );
        expect(file.rows).toEqual([
            ["foo bar", "bar baz", "baz quux"],
            ["field1", "field2", "field3"],
        ]);
    });

    test("reads the headers", () => {
        const file = parseTextFile(
            [
                "#separator:Pipe",
                "#html:true",
                "#tags:one two",
                "#columns:Front|Back|Deck|Tags|Guid|Type",
                "#notetype:Basic",
                "#deck:Fallback",
                "#notetype column:6",
                "#deck column:3",
                "#tags column:4",
                "#guid column:5",
                "a|b|Spanish::Verbs|x y|g1|Cloze",
            ].join("\n"),
        );
        expect(file).toMatchObject({
            separator: "|",
            html: true,
            tags: ["one", "two"],
            columns: ["Front", "Back", "Deck", "Tags", "Guid", "Type"],
            notetype: "Basic",
            deck: "Fallback",
            notetypeColumn: 6,
            deckColumn: 3,
            tagsColumn: 4,
            guidColumn: 5,
        });
        expect(file.rows).toEqual([["a", "b", "Spanish::Verbs", "x y", "g1", "Cloze"]]);
    });

    test("accepts a literal separator character and every named one", () => {
        expect(parseTextFile("#separator:;\na;b").separator).toBe(";");
        expect(parseTextFile("#separator:tab\na\tb").separator).toBe("\t");
        expect(parseTextFile("#separator:Comma\na,b").separator).toBe(",");
        expect(parseTextFile("#separator:Semicolon\na;b").separator).toBe(";");
        expect(parseTextFile("#separator:Space\na b").separator).toBe(" ");
        expect(parseTextFile("#separator:Colon\na:b").separator).toBe(":");
        expect(parseTextFile("#separator:\na\tb").separator).toBe("\t");
    });

    test("ignores unknown headers and bad column numbers", () => {
        const file = parseTextFile("#unknown:1\n#deck column:x\na\tb");
        expect(file.deckColumn).toBeNull();
        expect(file.rows).toEqual([["a", "b"]]);
    });

    test("does not treat a # inside a row as a comment", () => {
        expect(parseTextFile("a #1\tb #2").rows).toEqual([["a #1", "b #2"]]);
    });

    test("reads a last row without a new line and a quoted empty field", () => {
        expect(parseTextFile('a\t""\nb\tc').rows).toEqual([
            ["a", ""],
            ["b", "c"],
        ]);
    });
});

describe("textFileToNotes", () => {
    test("makes basic notes of two columns, in the default deck", () => {
        const notes = textFileToNotes(parseTextFile("q1\ta1\nq2\ta2"), "My file");
        expect(notes).toHaveLength(2);
        expect(notes[0]).toMatchObject({
            deck: "My file",
            kind: "basic",
            fields: ["q1", "a1"],
            tags: [],
            fieldNames: ["Field 1", "Field 2"],
        });
        expect(notes[0].guid).toMatch(/^csv-/);
        expect(notes[0].guid).not.toBe(notes[1].guid);
    });

    test("uses deck, tags, guid and note type columns, and the column names", () => {
        const file = parseTextFile(
            [
                "#separator:tab",
                "#columns:Front\tBack\tDeck\tTags",
                "#deck column:3",
                "#tags column:4",
                "#tags:all",
                "#notetype:Basic (and reversed card)",
                "#guid column:5",
                "f\tb\tSpanish::Verbs\tx y\tguid-1",
                "f2\tb2\t\t\t",
            ].join("\n"),
        );
        const notes = textFileToNotes(file, "Default deck");
        expect(notes[0]).toMatchObject({
            guid: "guid-1",
            deck: "Spanish::Verbs",
            kind: "reversed",
            fields: ["f", "b"],
            fieldNames: ["Front", "Back"],
            tags: ["all", "x", "y"],
        });
        expect(notes[1]).toMatchObject({ deck: "Default deck", tags: ["all"] });
    });

    test("finds the kind from the note type", () => {
        const kinds = (header: string, row: string) =>
            textFileToNotes(parseTextFile(`${header}\n${row}`), "D")[0].kind;
        expect(kinds("#notetype:Cloze", "{{c1::a}} b\textra")).toBe("cloze");
        expect(kinds("#notetype:Basic (optional reversed card)", "a\tb\ty")).toBe("other");
        expect(kinds("#notetype:Basic (and reversed card)", "a\tb\tc")).toBe("other");
        expect(kinds("#separator:tab", "{{c1::a}} b\textra")).toBe("cloze");
        expect(kinds("#separator:tab", "a\tb\tc")).toBe("other");
        expect(kinds("#notetype column:3", "a\tb\tCloze")).toBe("cloze");
    });

    test("skips rows without any content", () => {
        expect(textFileToNotes(parseTextFile("a\tb\n\t\n"), "D")).toHaveLength(1);
    });
});
