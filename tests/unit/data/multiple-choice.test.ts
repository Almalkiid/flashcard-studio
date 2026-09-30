import {
    isChoiceCorrect,
    parseMultipleChoice,
    shuffledOrder,
} from "src/data/data-structures/card/questions/multiple-choice";

describe("parseMultipleChoice", () => {
    test("a checklist with a checked item is multiple choice", () => {
        expect(
            parseMultipleChoice(
                "- [ ] The CAE\n- [x] The board\n- [ ] Management\nExplanation: the board approves it.",
            ),
        ).toEqual({
            lead: "",
            explanation: "Explanation: the board approves it.",
            multiSelect: false,
            options: [
                { text: "The CAE", correct: false },
                { text: "The board", correct: true },
                { text: "Management", correct: false },
            ],
        });
    });
    test("several checked items make a multi-select question", () => {
        expect(parseMultipleChoice("* [X] A\n* [x] B\n* [ ] C")?.multiSelect).toBe(true);
    });
    test("text before the list is the lead, continuation lines belong to their item", () => {
        const mc = parseMultipleChoice("Choose one:\n- [ ] A\n  more about A\n- [x] B");
        expect(mc?.lead).toBe("Choose one:");
        expect(mc?.options[0].text).toBe("A\nmore about A");
    });
    test.each([
        ["one item", "- [x] A"],
        ["nothing checked", "- [ ] A\n- [ ] B"],
        ["a nested task", "- [x] A\n  - [ ] A1\n- [ ] B"],
        ["a plain bullet among the items", "- [x] A\n- B\n- [ ] C"],
        ["an empty item", "- [x] A\n- [ ] "],
        ["two separate lists", "- [x] A\n- [ ] B\n\ntext\n\n- [ ] C\n- [x] D"],
        ["an ordinary answer", "The board approves the charter."],
    ])("%s stays an ordinary card", (_name, back) => {
        expect(parseMultipleChoice(back)).toBeNull();
    });
});

describe("parseMultipleChoice edge cases", () => {
    test("Windows line endings and a loose list (blank lines between items) still work", () => {
        const mc = parseMultipleChoice("- [x] A\r\n\r\n- [ ] B\r\nBecause.");
        expect(mc?.options).toEqual([
            { text: "A", correct: true },
            { text: "B", correct: false },
        ]);
        expect(mc?.explanation).toBe("Because.");
    });
    test("an item's text goes on after a blank line when the next line is indented", () => {
        expect(parseMultipleChoice("- [x] A\n\n  second paragraph\n- [ ] B")?.options[0].text).toBe(
            "A\n\nsecond paragraph",
        );
    });
    test("a plain bullet in the explanation is fine, a plain bullet before the list is a mixed list", () => {
        expect(parseMultipleChoice("- [x] A\n- [ ] B\nSee:\n- one\n- two")?.explanation).toBe(
            "See:\n- one\n- two",
        );
        expect(parseMultipleChoice("- note\n- [x] A\n- [ ] B")).toBeNull();
    });
    test("a bullet that changes the list, or a task in the explanation, is not one list", () => {
        expect(parseMultipleChoice("- [x] A\n* [ ] B")).toBeNull();
        expect(parseMultipleChoice("- [x] A\n- [ ] B\nText\n- [ ] C")).toBeNull();
    });
    test("an item that is empty on its first line but goes on below is trimmed", () => {
        expect(parseMultipleChoice("- [x]\n  Text\n- [ ] B")?.options[0].text).toBe("Text");
    });
    test("other task states and a missing space are plain text", () => {
        expect(parseMultipleChoice("- [x]A\n- [ ] B")).toBeNull();
        expect(parseMultipleChoice("- [-] A\n- [x] B")).toBeNull();
    });
    test("a list indented as a whole still counts, its own indent is the top level", () => {
        expect(parseMultipleChoice("  - [x] A\n  - [ ] B")?.options).toHaveLength(2);
    });
    test("a less indented task than the first is not one list", () => {
        expect(parseMultipleChoice("  - [x] A\n- [ ] B")).toBeNull();
    });
});

test("shuffledOrder is a permutation", () => {
    let s = 1;
    const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const order = shuffledOrder(5, random);
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
});

test("shuffledOrder follows the random numbers, and handles zero and one option", () => {
    expect(shuffledOrder(0, () => 0.5)).toEqual([]);
    expect(shuffledOrder(1, () => 0.5)).toEqual([0]);
    // random() = 0 always swaps with the first position
    expect(shuffledOrder(3, () => 0)).toEqual([1, 2, 0]);
    // random() just under 1 never moves anything
    expect(shuffledOrder(3, () => 0.999)).toEqual([0, 1, 2]);
});

describe("isChoiceCorrect", () => {
    const single = parseMultipleChoice("- [ ] A\n- [x] B\n- [ ] C");
    const multi = parseMultipleChoice("- [x] A\n- [ ] B\n- [x] C");

    test("the right option alone is right, any other choice is wrong", () => {
        expect(isChoiceCorrect(single, [1])).toBe(true);
        expect(isChoiceCorrect(single, [0])).toBe(false);
        expect(isChoiceCorrect(single, [0, 1])).toBe(false);
    });
    test("a multi-select answer needs every right option and no wrong one", () => {
        expect(isChoiceCorrect(multi, [2, 0])).toBe(true);
        expect(isChoiceCorrect(multi, [0])).toBe(false);
        expect(isChoiceCorrect(multi, [0, 1, 2])).toBe(false);
    });
    test("choosing nothing is never right", () => {
        expect(isChoiceCorrect(single, [])).toBe(false);
    });
});
