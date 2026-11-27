import {
    CardType,
    endsWithFence,
    isClozeKind,
    showsBackOnly,
} from "src/data/data-structures/card/question";

test("cloze kinds: text clozes and image clozes; never multiple choice, no typed answer of their own", () => {
    expect(isClozeKind(CardType.Cloze)).toBe(true);
    expect(isClozeKind(CardType.ImageCloze)).toBe(true);
    expect(isClozeKind(CardType.ImageOcclusion)).toBe(false);
    expect(isClozeKind(CardType.MultiLineBasic)).toBe(false);
});

test("cards that show only their back, which is the whole card", () => {
    expect(showsBackOnly(CardType.Cloze)).toBe(true);
    expect(showsBackOnly(CardType.ImageOcclusion)).toBe(true);
    expect(showsBackOnly(CardType.ImageCloze)).toBe(true);
    expect(showsBackOnly(CardType.SingleLineBasic)).toBe(false);
    expect(showsBackOnly(CardType.Callout)).toBe(false);
});

describe("endsWithFence: a schedule comment never goes on a closing fence line", () => {
    test.each([
        ["```", true],
        ["text\n```", true],
        ["text\n~~~", true],
        ["text\n~~~~", true],
        ["text\n  ~~~  ", true],
        ["text ~~~ more", false],
        ["plain text", false],
    ])("%p → %p", (text, expected) => {
        expect(endsWithFence(text)).toBe(expected);
    });
});
