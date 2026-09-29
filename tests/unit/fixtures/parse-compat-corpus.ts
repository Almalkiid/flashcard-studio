/**
 * Legacy card syntax, written to check that new parser features never change how an existing note
 * parses with the default settings. See tests/unit/parser-compat-baseline.test.ts.
 *
 * Do NOT add notes here that use a NEW syntax (callout cards, \cloze, start markers): those change
 * parsing on purpose and have their own tests. Notes that merely look similar (a callout that also
 * holds a cloze, a `?` line inside a callout, ...) belong here, because they must keep parsing as
 * they always did.
 */
export const COMPAT_CORPUS: Record<string, string> = {
    "corpus/single-line": "Q1::A1\nQ2:: A2\nQ3:::A3 reversed\n\nplain text\nQ4 ::A4",
    "corpus/single-line-with-schedule":
        "Q1::A1\n<!--SR:!2021-08-11,4,270-->\nQ2::A2 <!--SR:!2021-08-11,4,270-->\nQ3:::A3\n> [!sr|card-metadata] \n> <!--SR:!2021-08-11,4,270!2021-08-12,5,250-->\nnext line",
    "corpus/multiline":
        "Question\n?\nAnswer\n\nQuestion 2 line 1\nline 2\n??\nAnswer 2\nmore answer\n\nlast",
    "corpus/multiline-blank-lines-in-question":
        "Paragraph one of the question\n\nParagraph two of the question\n?\nThe answer",
    "corpus/multiline-blank-lines-in-answer":
        "Question\n?\nAnswer para 1\n\nAnswer para 2\n\nfollowing text",
    "corpus/multiline-with-schedule":
        "Question\n?\nAnswer\n<!--SR:!2021-08-11,4,270-->\n\nQ2\n?\nA2 <!--SR:!2021-08-11,4,270-->\n",
    "corpus/multiline-empty-answer": "Question\n?\n\nOther::card\n\nQ\n?",
    "corpus/multiline-code-block":
        "How do I print?\n?\n```python\nprint('x')\n\nprint('y')\n```\nDone\n\nNext::card",
    "corpus/multiline-tilde-block": "Q\n?\n~~~\ncode :: here\n~~~\n\nA::B",
    "corpus/cloze-simple":
        "The capital of ==France== is ==Paris==\n\nBold **cloze** here\n\nCurly {{cloze}} here",
    "corpus/cloze-paragraph":
        "intro line\nthe ==cloze== here\nmore text\n\nnext paragraph without a cloze\n\nanother ==one==",
    "corpus/cloze-with-schedule":
        "A ==b== and ==c==\n<!--SR:!2021-08-11,4,270!2021-08-12,5,250-->\n\nD ==e== <!--SR:!2021-08-11,4,270-->",
    "corpus/cloze-multiline-paragraph-comment-at-end":
        "L1 ==a==\nL2 ==b==\n<!--SR:!2021-08-11,4,270!2021-08-12,5,250-->\n\nnext ==c==",
    "corpus/cloze-numbered-and-hints":
        "==[1;;]alpha;;first== and ==[1;;]beta== and ==[2;;]gamma;;third== plain",
    "corpus/cloze-in-list": "- item ==one==\n- item ==two==\n\n1. numbered ==three==\n2. plain",
    "corpus/cloze-in-heading-and-quote": "# Heading ==h1==\n\n> quoted ==q==\n> more quote",
    "corpus/cloze-in-table": "| a | b |\n|---|---|\n| ==x== | y |\n\nafter",
    "corpus/math-plain": "$$\na = b\n$$\n\nInline $x^2$ and ==cloze== here",
    "corpus/math-with-highlight-in-formula":
        "The formula $E = mc^2$ means ==energy==\n\n$$ x + y $$\n$a$::$b$",
    "corpus/inline-code-with-separators":
        "`typedef std::vector<int> t;`\n\nUse `a::b` and ==this==\n\nreal::card",
    "corpus/code-fence-then-card": "```js\nconst a = { b: 1 }; // :: not a card\n```\n\nQ::A",
    "corpus/html-comments":
        "<!-- a comment -->\nQ1::A1\n<!--\nmulti\nline\n-->\nQ2::A2\n\n<!--SR:!2021-08-11,4,270-->\nQ3::A3",
    "corpus/tags-and-block-ids":
        "#flashcards/science Q1::A1\n\n#flashcards/x\nQuestion\n?\nAnswer ^abc123\n\nCloze ==x== ^blk",
    "corpus/frontmatter": "---\ntags:\n  - flashcards/philosophy\n---\n\nWho::Socrates\n\nQ\n?\nA",
    "corpus/crlf": "Q1::A1\r\n\r\nQuestion\r\n?\r\nAnswer\r\n\r\ncloze ==x==\r\n",
    "corpus/rtl": "سؤال::جواب\n\nمن ==هو==",
    "corpus/no-cards": "# Title\n\nJust some prose.\n\n- a list\n- of things\n\n> a plain quote",
    "corpus/empty": "",
    "corpus/only-blank-lines": "\n\n\n",
    "corpus/unterminated-highlight": "lorem ipsum ==p\ndolor won==\n\nsrdf ==\n\ndolor won=",
    "corpus/separator-lookalikes": "What is 1 ? 2?\n\nQ\n? \nA\n\nQ\n???\nA",
    "corpus/callout-note-plain": "> [!note] Title\n> body text\n> more\n\nafter::card",
    "corpus/callout-tip-after-multiline-answer":
        "**Q**\n?\n- A1\n- A2\n> [!tip] The board\n> Extra tip.\n\n**Q2**\n?\nA",
    "corpus/callout-with-inline-separator":
        "> [!question] What is std::vector\n> A dynamic array\n\nnext::card",
    "corpus/callout-with-cloze":
        "> [!question] The capital of ==France==\n> is a city\n<!--SR:!2021-08-11,4,270-->\n\nnext ==c==",
    "corpus/callout-sr-layout-1105":
        "> [!tip] Kentucky\n> - ==Louisville==\n> - Lexington\n<!--SR:!2026-01-01,4,270-->\n\n- ==Frankfort==",
    "corpus/callout-with-multiline-separator-lines": "> [!note] Front\n> ?\n> Back\n\nQ\n?\nA",
    "corpus/callout-question-plain-text-before-card": "Some intro\n> [!note] not a card\n\nQ::A",
    "corpus/nested-quote-cloze": "> > deep ==quote==\n> back\n\nx",
    "corpus/end-marker-friendly":
        "Q1\n?\nA1\n+++\nQ2\n?\nA2 line1\n\nA2 line2\n+++\n\nCloze ==x== here\n+++\n\nQ3::A3\n+++\nQ4\n---\nQ5\n?\nA5\n---",
    "corpus/end-marker-unterminated-last-card":
        "Q1\n?\nA1\n---\nQ2\n?\nA2 with no end marker at all",
    "corpus/end-marker-with-schedule":
        "Q1\n?\nA1\n<!--SR:!2021-08-11,4,270-->\n+++\nQ2\n?\nA2\n<!--SR:!2021-08-11,4,270-->\n+++",
    "corpus/end-marker-cloze-then-text": "cloze ==a==\n\nsecond paragraph\n\n---\n\nthird ==b==",
    "corpus/plus-lines-in-prose": "Some text\n\n+++\n\nQ::A\n\n+++\n\ncloze ==z==",
    "corpus/dashes-hr-in-prose": "Intro\n\n---\n\nQ::A\n\n---\n\nQuestion\n?\nAnswer\n\n---",
    "corpus/definition-list-ish": "Term::Definition one\nTerm2::Definition two\n\nTerm3:::Two-way",
    "corpus/long-list-question":
        "List the layers\n?\n1. Physical\n2. Data link\n\n3. Network\n4. Transport\n\nUnrelated ==text==",
    "corpus/table-answer": "Compare\n?\n| a | b |\n|---|---|\n| 1 | 2 |\n\nAnother::card",
    "corpus/emoji-and-unicode": "Café::☕ latte\n\nnaïve ==élève== 😀",
    "corpus/schedule-old-format":
        "Q1::A1\n<!--SR:2021-08-11,4,270-->\n\nc ==a==\n<!--SR:2021-08-11,4,270-->",
};
