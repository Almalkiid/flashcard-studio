import {
    escapeHtmlText,
    fileExtension,
    HtmlContext,
    isMediaFile,
    markdownToHtml,
} from "src/import-export/markdown-to-html";

/** Resolves every embed to the file's own name, except files called missing. */
const context: HtmlContext = { embed: (target) => (target.startsWith("missing") ? null : target) };
const html = (markdown: string): string => markdownToHtml(markdown, context);

describe("inline formatting", () => {
    test.each([
        ["plain text", "plain text"],
        ["**bold** and __bold__", "<b>bold</b> and <b>bold</b>"],
        ["*italic* and _italic_", "<i>italic</i> and <i>italic</i>"],
        ["***both***", "<b><i>both</i></b>"],
        ["~~gone~~ and ==marked==", "<s>gone</s> and <mark>marked</mark>"],
        ["snake_case_word stays", "snake_case_word stays"],
        ["2 * 3 * 4", "2 * 3 * 4"],
        ["`code` here", "<code>code</code> here"],
        ["`a < b && **not bold**`", "<code>a &lt; b &amp;&amp; **not bold**</code>"],
        ["a < b & c > d", "a &lt; b &amp; c &gt; d"],
        ["already &amp; escaped &#58;", "already &amp; escaped &#58;"],
        ["std:&#58;vector", "std:&#58;vector"],
    ])("%p", (markdown, expected) => {
        expect(html(markdown)).toBe(expected);
    });

    test("keeps tags Anki shows", () => {
        expect(html('a<br>b <u>u</u> <span style="color:red">r</span>')).toBe(
            'a<br>b <u>u</u> <span style="color:red">r</span>',
        );
        expect(html("<script>x</script>")).toBe("&lt;script&gt;x&lt;/script&gt;");
    });

    test("removes backslash escapes and does not take escaped characters as formatting", () => {
        expect(html("1\\. not a list \\*star\\* \\_a\\_ \\#tag")).toBe(
            "1. not a list *star* _a_ #tag",
        );
    });
});

describe("math", () => {
    test("uses Anki's MathJax delimiters and escapes what HTML would take for a tag", () => {
        expect(html("Inline $x_1 < y^2$ and $$a & b$$ end")).toBe(
            "Inline \\(x_1 &lt; y^2\\) and \\[a &amp; b\\] end",
        );
    });

    test("does not read dollar amounts as math", () => {
        expect(html("It costs $5 and $10 in total")).toBe("It costs $5 and $10 in total");
        expect(html("$ x $")).toBe("$ x $");
    });

    test("does not format inside math", () => {
        expect(html("$a*b*c$")).toBe("\\(a*b*c\\)");
    });
});

describe("links and embeds", () => {
    test("embeds images and sounds", () => {
        expect(html("![[cat.png]] and ![[meow.mp3]] and ![[clip.mp4]]")).toBe(
            '<img src="cat.png"> and [sound:meow.mp3] and [sound:clip.mp4]',
        );
        expect(html("![[cat.png|300]]")).toBe('<img src="cat.png">');
        expect(html("![alt](folder/pic%201.jpg)")).toBe('<img src="folder/pic 1.jpg">');
    });

    test("leaves an embed of a file that cannot be found as text", () => {
        expect(html("![[missing.png]]")).toBe("![[missing.png]]");
    });

    test("writes an embedded note as its name and a web image as an image", () => {
        expect(html("![[Some note#Heading]]")).toBe("Some note");
        expect(html("![pic](https://example.org/a.png)")).toBe(
            '<img src="https://example.org/a.png" alt="pic">',
        );
        expect(html("![doc](notes/readme.md)")).toBe("doc");
    });

    test("writes wikilinks as text and web links as links", () => {
        expect(html("See [[Note]], [[Note#Section|the section]] and [[Other^block]]")).toBe(
            "See Note, the section and Other",
        );
        expect(html("[site](https://example.org) and [local](notes/a.md)")).toBe(
            '<a href="https://example.org">site</a> and local',
        );
    });
});

describe("blocks", () => {
    test("writes lines as lines", () => {
        expect(html("line 1\nline 2\nline 3")).toBe("line 1<br>line 2<br>line 3");
    });

    test("writes the plugin's <br> line as a blank line", () => {
        expect(html("a\n<br>\nb")).toBe("a<br><br>b");
    });

    test("writes a blank line between paragraphs as a blank line", () => {
        expect(html("one\n\ntwo")).toBe("one<br><br>two");
    });

    test("writes lists, nested lists and numbered lists", () => {
        expect(html("- a\n- b\n    - c\n- d")).toBe(
            "<ul><li>a</li><li>b<ul><li>c</li></ul></li><li>d</li></ul>",
        );
        expect(html("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
        expect(html("- a\n1. b")).toBe("<ul><li>a</li></ul><ol><li>b</li></ol>");
        expect(html("intro:\n- **a**")).toBe("intro:<ul><li><b>a</b></li></ul>");
    });

    test("writes headings, rules, quotes and callouts", () => {
        expect(html("## Title")).toBe("<h2>Title</h2>");
        expect(html("---")).toBe("<hr>");
        expect(html("> quoted\n> text")).toBe("<blockquote>quoted<br>text</blockquote>");
        expect(html("> [!tip] The board\n> Reports to the board.")).toBe(
            "<blockquote><b>The board</b><br>Reports to the board.</blockquote>",
        );
        expect(html("> [!note]\n> body")).toBe("<blockquote><b>note</b><br>body</blockquote>");
    });

    test("writes code blocks as they are, blank lines included", () => {
        expect(html("```ts\nlet a = 1 < 2;\n\nlet b;\n```\nafter")).toBe(
            "<pre><code>let a = 1 &lt; 2;\n\nlet b;</code></pre>after",
        );
        expect(html("~~~\nx\n~~~")).toBe("<pre><code>x</code></pre>");
    });

    test("writes an empty text as nothing", () => {
        expect(html("")).toBe("");
        expect(html("\n\n")).toBe("");
    });

    test("keeps Anki cloze syntax untouched", () => {
        expect(html("{{c1::Canberra::city}} is **the** capital")).toBe(
            "{{c1::Canberra::city}} is <b>the</b> capital",
        );
    });
});

describe("helpers", () => {
    test("fileExtension and isMediaFile", () => {
        expect(fileExtension("a.PNG")).toBe("png");
        expect(fileExtension("noextension")).toBe("");
        expect(isMediaFile("a.jpg")).toBe(true);
        expect(isMediaFile("a.mp3")).toBe(true);
        expect(isMediaFile("a.md")).toBe(false);
    });

    test("escapeHtmlText leaves character references alone", () => {
        expect(escapeHtmlText("<a> & &amp; &#58; &b")).toBe("&lt;a&gt; &amp; &amp; &#58; &amp;b");
    });
});
