import { footnoteDefinitions, withCardFootnotes } from "src/utils/card-footnotes";

// Issue #21: a card is drawn from its own lines, so a footnote's definition elsewhere in the note was not there and
// Obsidian drew the reference as a plain "1" run into the text.

const NOTE = [
    "#flashcards",
    "",
    "Te lo pido por ==favor== amigo[^1]",
    "",
    "Another card[^note] and[^1] again::Back",
    "",
    "[^1]: Hola",
    "[^note]: First line",
    "    second line",
    "[^unused]: Never cited",
].join("\n");

const DEFINITIONS = footnoteDefinitions(NOTE);

test("reads every definition of the note by its id", () => {
    expect([...DEFINITIONS.keys()]).toEqual(["1", "note", "unused"]);
    expect(DEFINITIONS.get("1")).toBe("[^1]: Hola");
    expect(DEFINITIONS.get("note")).toBe("[^note]: First line\n    second line");
});

test("a definition inside a code block is not one", () => {
    const note = ["```", "[^1]: code", "```", "[^1]: Hola", "~~~md", "[^2]: code", "~~~"].join(
        "\n",
    );
    expect([...footnoteDefinitions(note)]).toEqual([["1", "[^1]: Hola"]]);
});

test("a card gets the definitions of the footnotes it cites, once each, in the order cited", () => {
    expect(withCardFootnotes("Another card[^note] and[^1] again[^note]", DEFINITIONS)).toBe(
        "Another card[^note] and[^1] again[^note]\n\n[^note]: First line\n    second line\n\n[^1]: Hola",
    );
});

test("a card that cites no footnote is left as it is", () => {
    expect(withCardFootnotes("No footnote here", DEFINITIONS)).toBe("No footnote here");
});

test("a citation with no definition in the note is left alone", () => {
    expect(withCardFootnotes("Missing[^9]", DEFINITIONS)).toBe("Missing[^9]");
});

test("a definition the card already holds is not added twice", () => {
    expect(withCardFootnotes("Card[^1]\n\n[^1]: Hola", DEFINITIONS)).toBe("Card[^1]\n\n[^1]: Hola");
});

test("an inline footnote and a definition line are not citations", () => {
    expect(withCardFootnotes("Inline^[just here] text", DEFINITIONS)).toBe(
        "Inline^[just here] text",
    );
    expect(withCardFootnotes("[^1]: Hola", DEFINITIONS)).toBe("[^1]: Hola");
});
