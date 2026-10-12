import {
    decodeEntities,
    FieldConversionContext,
    fieldToMarkdown,
    findMediaReferences,
    isExternalReference,
} from "src/import-export/field-to-markdown";

import { simpleHtmlToMarkdown } from "./helpers/simple-html-to-markdown";

const context: FieldConversionContext = {
    htmlToMarkdown: simpleHtmlToMarkdown,
    resolveMedia: (reference) => (isExternalReference(reference) ? null : reference.toLowerCase()),
};

const convert = (html: string, plainText = false): string =>
    fieldToMarkdown(html, context, plainText);

describe("findMediaReferences", () => {
    test("finds images, sounds, audio and video, with any quotes", () => {
        const html =
            'a <img src="one.png"> b [sound:two.mp3] <img class=x src=three.jpg width=5> <audio src=\'four.ogg\'></audio><video src="five.mp4"></video>';
        expect(findMediaReferences(html)).toEqual([
            "two.mp3",
            "one.png",
            "three.jpg",
            "four.ogg",
            "five.mp4",
        ]);
    });

    test("decodes entities in a source", () => {
        expect(findMediaReferences('<img src="a&amp;b.png">')).toEqual(["a&b.png"]);
    });

    test("ignores empty sources and text without media", () => {
        expect(findMediaReferences('<img src=""> plain')).toEqual([]);
    });
});

test("isExternalReference tells web addresses and data from files", () => {
    expect(isExternalReference("https://x.org/a.png")).toBe(true);
    expect(isExternalReference("//x.org/a.png")).toBe(true);
    expect(isExternalReference("data:image/png;base64,AAAA")).toBe(true);
    expect(isExternalReference("a.png")).toBe(false);
    expect(isExternalReference("folder/a.png")).toBe(false);
});

test("decodeEntities decodes once", () => {
    expect(decodeEntities("&lt;b&gt; &amp;lt; &quot;x&quot; &#39;y&#39; a&nbsp;b")).toBe(
        "<b> &lt; \"x\" 'y' a b",
    );
});

describe("fieldToMarkdown", () => {
    test("converts formatting and line breaks", () => {
        expect(convert("<b>bold</b> and <i>italic</i><br>next line")).toBe(
            "**bold** and *italic*\nnext line",
        );
    });

    test("returns an empty string for an empty field", () => {
        expect(convert("")).toBe("");
        expect(convert("<br>")).toBe("");
    });

    test("writes media as embeds", () => {
        expect(convert('Look <img src="Cat.PNG"> and hear [sound:Meow.mp3]')).toBe(
            "Look ![[cat.png]] and hear ![[meow.mp3]]",
        );
        expect(convert('<video src="clip.mp4"></video><source src="clip.webm">')).toBe(
            "![[clip.mp4]]",
        );
    });

    test("leaves web images to the converter", () => {
        expect(convert('<img src="https://x.org/a.png">')).toBe("![](https://x.org/a.png)");
    });

    test("keeps math exactly, in Obsidian's delimiters", () => {
        expect(convert("Inline \\(x_1 &lt; y^2\\) and display \\[a_b\\] end")).toBe(
            "Inline $x_1 < y^2$ and display $$a_b$$ end",
        );
        expect(convert("[$]z_2[/$] and [$$]w_3[/$$]")).toBe("$z_2$ and $$w_3$$");
    });

    test("turns Anki's div lines into lines", () => {
        expect(convert("first<div>second</div><div><br></div><div>fourth</div>")).toBe(
            "first\nsecond\n<br>\nfourth",
        );
        expect(convert("<div>a</div><div>b</div>")).toBe("a\nb");
        expect(convert("a<div>b</div>c")).toBe("a\nb\nc");
    });

    test("writes a paragraph break as a line with only <br>, which does not end a card", () => {
        expect(convert("<p>one</p><p>two</p>")).toBe("one\n<br>\ntwo");
    });

    test("keeps blank lines inside fenced code", () => {
        const code = "```\nline1\n\nline3\n```";
        expect(convert(code)).toBe(code);
        expect(convert("intro<br>" + code)).toBe("intro\n" + code);
    });

    test("writes numbered lines as a list again", () => {
        expect(convert("1. first<br>2. second")).toBe("1. first\n2. second");
    });

    test("treats plain text as text: brackets are not tags, new lines are lines", () => {
        expect(convert("a <b> c & d\nnext", true)).toBe("a <b> c & d\nnext");
    });

    test("normalises non-breaking spaces and trailing spaces", () => {
        expect(convert("a&nbsp;b   <br>c")).toBe("a b\nc");
    });
});
