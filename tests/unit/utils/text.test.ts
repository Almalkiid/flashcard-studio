import {
    findLineIndexOfSearchStringIgnoringWs,
    MultiLineTextFinder,
    parseObsidianFrontmatterTag,
    splitNoteIntoFrontmatterAndContent,
    splitTextIntoLineArray,
    stringTrimStart,
    TextDirection,
} from "src/utils/text";

describe("TextDirection", () => {
    test("keeps its numeric values and reverse mapping", () => {
        expect(TextDirection.Unspecified).toBe(0);
        expect(TextDirection.Ltr).toBe(1);
        expect(TextDirection.Rtl).toBe(2);
        expect(TextDirection[2]).toBe("Rtl");
    });
});

describe("splitTextIntoLineArray", () => {
    test.each([
        ["", [""]],
        ["a", ["a"]],
        ["a\n", ["a", ""]],
        ["a\r\nb", ["a", "b"]],
        ["a\rb", ["a", "b"]],
        ["a\nb", ["a", "b"]],
        ["a\r\r\nb", ["a", "", "b"]],
        ["a\n\rb", ["a", "", "b"]],
        ["\n", ["", ""]],
    ])("splits %j into %j", (text, expected) => {
        expect(splitTextIntoLineArray(text)).toEqual(expected);
    });

    test("LF, CR and CRLF texts of the same five lines split identically", () => {
        const lines = ["one", "two", "", "four", "five"];
        for (const eol of ["\n", "\r", "\r\n"]) {
            expect(splitTextIntoLineArray(lines.join(eol))).toEqual(lines);
        }
    });

    test("the Unicode line and paragraph separators are not line breaks", () => {
        expect(splitTextIntoLineArray("a\u2028b\u2029c")).toEqual(["a\u2028b\u2029c"]);
    });

    test("right to left text splits like any other", () => {
        expect(splitTextIntoLineArray("سؤال\r\nجواب")).toEqual(["سؤال", "جواب"]);
    });

    test("a non-string throws", () => {
        expect(() => splitTextIntoLineArray(undefined as unknown as string)).toThrow(TypeError);
    });
});

describe("stringTrimStart", () => {
    test.each([
        ["  a", ["  ", "a"]],
        ["\t\n a b ", ["\t\n ", "a b "]],
        ["   ", ["   ", ""]],
        ["x  ", ["", "x  "]],
        ["a", ["", "a"]],
        ["\u200bx", ["", "\u200bx"]],
        ["\ufeffx", ["\ufeff", "x"]],
        ["\u00a0x", ["\u00a0", "x"]],
        ["\r\n\tx", ["\r\n\t", "x"]],
    ])("splits %j into %j", (text, expected) => {
        expect(stringTrimStart(text)).toEqual(expected);
    });

    test("empty, null and undefined give two empty strings", () => {
        expect(stringTrimStart("")).toEqual(["", ""]);
        expect(stringTrimStart(null)).toEqual(["", ""]);
        expect(stringTrimStart(undefined as unknown as string)).toEqual(["", ""]);
    });

    test("right to left text keeps its letters in the second part", () => {
        expect(stringTrimStart("  سؤال ")).toEqual(["  ", "سؤال "]);
    });
});

describe("splitNoteIntoFrontmatterAndContent", () => {
    test.each([
        ["---\ntags: a\n---\nQ::A", ["---\ntags: a\n---", "\n\n\nQ::A"]],
        ["Q::A\nline2", ["", "Q::A\nline2"]],
        ["---\ntags: a\nQ::A", ["", "---\ntags: a\nQ::A"]],
        ["---\n---", ["---\n---", "\n"]],
        ["---\n---\nX", ["---\n---", "\n\nX"]],
        ["---\na\nb\n---", ["---\na\nb\n---", "\n\n\n"]],
        ["", ["", ""]],
        ["---", ["", "---"]],
        ["---\n", ["", "---\n"]],
    ])("splits %j into %j", (note, expected) => {
        expect(splitNoteIntoFrontmatterAndContent(note)).toEqual(expected);
    });

    test("line endings become LF in both parts", () => {
        expect(splitNoteIntoFrontmatterAndContent("---\r\na: 1\r\n---\r\nQ::A")).toEqual([
            "---\na: 1\n---",
            "\n\n\nQ::A",
        ]);
        expect(splitNoteIntoFrontmatterAndContent("---\ra: 1\r---\rQ::A")).toEqual([
            "---\na: 1\n---",
            "\n\n\nQ::A",
        ]);
        expect(splitNoteIntoFrontmatterAndContent("Q\r\nA")).toEqual(["", "Q\nA"]);
    });

    test.each([
        ["a leading blank line", "\n---\na: 1\n---\nQ"],
        ["a trailing space on the opening fence", "--- \na: 1\n---\nQ"],
        ["a trailing space on the closing fence", "---\na: 1\n--- \nQ"],
        ["a four dash opening fence", "----\na: 1\n---\nQ"],
        ["a byte order mark", "\ufeff---\na: 1\n---\nQ"],
    ])("%s means there is no frontmatter", (_name, note) => {
        expect(splitNoteIntoFrontmatterAndContent(note)).toEqual(["", note]);
    });

    test("the first closing fence ends it and a later block is ordinary content", () => {
        expect(splitNoteIntoFrontmatterAndContent("---\na: 1\n---\nQ\n---\nb: 2\n---\nA")).toEqual([
            "---\na: 1\n---",
            "\n\n\nQ\n---\nb: 2\n---\nA",
        ]);
    });

    test("a longer line of dashes inside does not close it", () => {
        expect(splitNoteIntoFrontmatterAndContent("---\na: 1\n----\n---\nQ")).toEqual([
            "---\na: 1\n----\n---",
            "\n\n\n\nQ",
        ]);
    });

    test("the content always has as many lines as the note", () => {
        for (const note of [
            "---\nرمز: ١\n---\nسؤال::جواب\nآخر",
            "---\n---\n",
            "---\nx\n---\n\n\ntext\n",
            "no frontmatter\nat all",
        ]) {
            const [, content] = splitNoteIntoFrontmatterAndContent(note);
            expect(splitTextIntoLineArray(content)).toHaveLength(
                splitTextIntoLineArray(note).length,
            );
        }
    });

    test("a missing note throws", () => {
        expect(() => splitNoteIntoFrontmatterAndContent(undefined as unknown as string)).toThrow(
            TypeError,
        );
    });
});

describe("findLineIndexOfSearchStringIgnoringWs", () => {
    test("finds the first line that equals the search string once the line is trimmed", () => {
        expect(findLineIndexOfSearchStringIgnoringWs(["a", " ? ", "?"], "?")).toBe(1);
        expect(findLineIndexOfSearchStringIgnoringWs(["\t?\t"], "?")).toBe(0);
        expect(findLineIndexOfSearchStringIgnoringWs(["", "x"], "")).toBe(0);
    });

    test("returns -1 for no lines or no match", () => {
        expect(findLineIndexOfSearchStringIgnoringWs([], "?")).toBe(-1);
        expect(findLineIndexOfSearchStringIgnoringWs(["a", "b"], "?")).toBe(-1);
    });

    test("the search string itself is not trimmed", () => {
        expect(findLineIndexOfSearchStringIgnoringWs(["  x  "], " x")).toBe(-1);
    });

    test("works on right to left text", () => {
        expect(findLineIndexOfSearchStringIgnoringWs(["سؤال", "  ؟  ", "جواب"], "؟")).toBe(1);
    });
});

describe("parseObsidianFrontmatterTag", () => {
    test.each([
        ["a", ["#a"]],
        ["#a", ["#a"]],
        ["a,#b,c/d", ["#a", "#b", "#c/d"]],
        ["a,,b", ["#a", "#b"]],
        ["a, b", ["#a", "# b"]],
        [",", []],
        ["", []],
        ["وسم,#آخر", ["#وسم", "#آخر"]],
    ])("parses %j into %j", (text, expected) => {
        expect(parseObsidianFrontmatterTag(text)).toEqual(expected);
    });

    test("null gives no tags", () => {
        expect(parseObsidianFrontmatterTag(null)).toEqual([]);
    });

    test("a list that was joined with commas by the caller gives one tag per entry", () => {
        expect(parseObsidianFrontmatterTag(["x", "#y"].join(","))).toEqual(["#x", "#y"]);
    });
});

describe("MultiLineTextFinder.find", () => {
    test("returns the index of the first run of equal lines", () => {
        expect(MultiLineTextFinder.find(["a", "b", "a", "b"], ["a", "b"])).toBe(0);
        expect(MultiLineTextFinder.find(["x", "a", "b"], ["a", "b"])).toBe(1);
        expect(MultiLineTextFinder.find(["a", "b", "c"], ["c"])).toBe(2);
    });

    test("trims both sides before comparing", () => {
        expect(MultiLineTextFinder.find([" x ", "\ty"], ["x", "y"])).toBe(0);
        expect(MultiLineTextFinder.find(["x", "y"], ["  x", "y  "])).toBe(0);
    });

    test("an empty search line matches an empty source line", () => {
        expect(MultiLineTextFinder.find(["a", "", "b"], ["", "b"])).toBe(1);
    });

    test("returns null for no match, an empty source or empty search lines", () => {
        expect(MultiLineTextFinder.find([], ["x"])).toBeNull();
        expect(MultiLineTextFinder.find(["a", "b"], ["b", "c"])).toBeNull();
        expect(MultiLineTextFinder.find(["a"], [])).toBeNull();
        expect(MultiLineTextFinder.find(["a"], ["a", "b"])).toBeNull();
    });

    test("a partial match does not hide the match that follows it", () => {
        expect(MultiLineTextFinder.find(["a", "b", "c"], ["a", "b", "x"])).toBeNull();
        expect(
            MultiLineTextFinder.find(
                ["Card Front", "Card Front", "?", "Card Back"],
                ["Card Front", "?", "Card Back"],
            ),
        ).toBe(1);
    });

    test("a false start longer than one line is found past (overlapping matches)", () => {
        expect(MultiLineTextFinder.find(["A", "A", "A", "B"], ["A", "A", "B"])).toBe(1);
        expect(MultiLineTextFinder.find(["a", "b", "a", "b", "a", "c"], ["a", "b", "a", "c"])).toBe(
            2,
        );
    });

    test("compares right to left lines like any other", () => {
        expect(MultiLineTextFinder.find(["  سؤال", "؟", "جواب  "], ["سؤال", "؟"])).toBe(0);
    });
});

describe("MultiLineTextFinder.findAndReplace", () => {
    test("replaces a verbatim occurrence and leaves the rest alone", () => {
        expect(MultiLineTextFinder.findAndReplace("one\ntwo\nthree", "two", "2")).toBe(
            "one\n2\nthree",
        );
    });

    test("replaces only the first occurrence", () => {
        expect(MultiLineTextFinder.findAndReplace("x x x", "x", "y")).toBe("y x x");
    });

    test("inserts the replacement literally", () => {
        expect(MultiLineTextFinder.findAndReplace("a b c", "b", "$&$&")).toBe("a $&$& c");
        expect(MultiLineTextFinder.findAndReplace("a b c", "b", "$")).toBe("a $ c");
        expect(MultiLineTextFinder.findAndReplace("cost $$", "$$", "$1")).toBe("cost $1");
        expect(MultiLineTextFinder.findAndReplace("a.b.c", ".", "$&")).toBe("a$&b.c");
    });

    test("an empty search is found at the start", () => {
        expect(MultiLineTextFinder.findAndReplace("abc", "", "X")).toBe("Xabc");
    });

    test("keeps the original line endings when the text matches verbatim", () => {
        expect(MultiLineTextFinder.findAndReplace("pre\r\nQ1\r\nA1\r\npost", "Q1\r\nA1", "R")).toBe(
            "pre\r\nR\r\npost",
        );
    });

    test("falls back to a line by line match that ignores padding", () => {
        expect(
            MultiLineTextFinder.findAndReplace("  Q1\n  ?\n  A1\nrest", "Q1\n?\nA1", "NEW"),
        ).toBe("NEW\nrest");
    });

    test("the line by line match gives the whole text LF endings", () => {
        expect(
            MultiLineTextFinder.findAndReplace("pre\r\n  Q1\r\n  A1\r\npost", "Q1\nA1", "R1\nR2"),
        ).toBe("pre\nR1\nR2\npost");
    });

    test("the line by line match also finds a match after an overlapping false start", () => {
        expect(MultiLineTextFinder.findAndReplace("x\n  A\n  A\n  A\n  B\ny", "A\nA\nB", "R")).toBe(
            "x\n  A\nR\ny",
        );
    });

    test("returns null when the text is not there", () => {
        expect(MultiLineTextFinder.findAndReplace("abc", "zzz", "x")).toBeNull();
        expect(MultiLineTextFinder.findAndReplace("a\nb", "a\nc", "x")).toBeNull();
    });

    test("removing all the text gives an empty string, not null", () => {
        expect(MultiLineTextFinder.findAndReplace("Q::A", "Q::A", "")).toBe("");
    });

    test("removing a padded block leaves an empty line", () => {
        expect(MultiLineTextFinder.findAndReplace("a\n  b\n  c\nd", "b\nc", "")).toBe("a\n\nd");
    });

    test("a replacement of any number of lines goes in", () => {
        // A call such as splice(i, n, ...lines) fails once `lines` is longer than the engine allows as arguments
        const lines = 500_000;
        const result = MultiLineTextFinder.findAndReplace(
            "top\n  q:  \n  a  \nbottom",
            "q:\na",
            Array(lines).fill("x").join("\n"),
        );
        expect(result).toHaveLength("top\n".length + 2 * lines - 1 + "\nbottom".length);
        expect(result.startsWith("top\nx\nx")).toBe(true);
        expect(result.endsWith("x\nx\nbottom")).toBe(true);
    });

    test("replaces right to left text", () => {
        expect(
            MultiLineTextFinder.findAndReplace("مقدمة\n  سؤال::جواب\nخاتمة", "سؤال::جواب", "س::ج"),
        ).toBe("مقدمة\n  س::ج\nخاتمة");
    });

    test("a missing source throws", () => {
        expect(() => MultiLineTextFinder.findAndReplace(null, "a", "b")).toThrow(TypeError);
    });
});
