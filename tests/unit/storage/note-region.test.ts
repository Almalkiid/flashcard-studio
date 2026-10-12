import { findCard, lineStarts, replaceCard } from "src/data/data-structures/card/note-region";

describe("lineStarts", () => {
    test.each([
        ["a\nb\nc", [0, 2, 4]],
        ["a\r\nb\r\nc", [0, 3, 6]],
        ["a\rb\rc", [0, 2, 4]],
        ["a\n\nb\n", [0, 2, 3, 5]],
        ["", [0]],
    ])("%j starts its lines at %j", (text, starts) => {
        expect(lineStarts(text)).toEqual(starts);
    });
});

describe("findCard", () => {
    const note = "tag\nQ::A\n\nR::B\n\nQ::A";

    test("the lines the card was read from are used when they still hold it", () => {
        expect(findCard(note, "Q::A", { first: 5, last: 5 })?.span).toMatchObject({
            first: 5,
            last: 5,
        });
        expect(findCard(note, "Q::A", { first: 1, last: 1 })?.span).toMatchObject({
            first: 1,
            last: 1,
        });
    });

    test("a card that moved is found when it is the only one like it", () => {
        expect(findCard(note, "R::B", { first: 9, last: 9 })?.span).toMatchObject({
            first: 3,
            last: 3,
        });
    });

    test("a card that moved and has a look-alike is not found", () => {
        expect(findCard(note, "Q::A", { first: 3, last: 3 })).toBeNull();
    });

    test("a card that is not there is not found, nor is one whose lines only start the same", () => {
        expect(findCard(note, "Q::AB", { first: 1, last: 1 })).toBeNull();
        expect(findCard("Q::AB", "Q::A", { first: 0, last: 0 })).toBeNull();
        expect(findCard("Q::AB", "Q::A", null)).toBeNull();
    });

    test("an empty card is not found", () => {
        expect(findCard(note, "", null)).toBeNull();
    });

    test("white space around the lines of a card is kept when the card is rewritten", () => {
        const region = findCard("  Q::A  \nx", "Q::A", { first: 0, last: 0 });
        expect(replaceCard("  Q::A  \nx", region, "Q::A\nnew")).toBe("  Q::A\nnew  \nx");
    });

    test("lines whose padding differs are replaced as a whole", () => {
        const text = "  Q\n  ?\n  A\nz";
        expect(replaceCard(text, findCard(text, "Q\n?\nA", null), "N")).toBe("N\nz");
    });

    test("the line endings of the note are used for the lines that are added", () => {
        const text = "a\r\nQ::A\r\nb\r\n";
        expect(replaceCard(text, findCard(text, "Q::A", null), "Q::A\nc")).toBe(
            "a\r\nQ::A\r\nc\r\nb\r\n",
        );
    });
});

describe("findCard with the place the card was last known at", () => {
    test("a card still at its offset is found there, with the look-alike before it passed by", () => {
        const text = "Q::A\n\nQ::A";
        expect(findCard(text, "Q::A", { first: 2, last: 2, offset: 6 })).toMatchObject({
            start: 6,
            end: 10,
            span: { first: 2, last: 2, offset: 6 },
        });
    });

    test("an offset that does not hold the card any more falls back to looking for it", () => {
        expect(findCard("new\nQ::A", "Q::A", { first: 0, last: 0, offset: 0 })).toMatchObject({
            start: 4,
        });
        expect(findCard("xQ::A", "Q::A", { first: 0, last: 0, offset: 1 })).toBeNull();
    });
});
