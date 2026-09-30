import { parseMultipleChoice } from "src/data/data-structures/card/questions/multiple-choice";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { setupStaticDateProvider20230906 } from "src/utils/dates";
import { TextDirection } from "src/utils/strings";

import { UnitTestSRFile } from "../helpers/unit-test-file";
import { unitTestSetupStandardDataStoreAlgorithm } from "../helpers/unit-test-setup";
import { createTestNoteQuestionParser } from "../sample-items";

// What a note's cards look like to the study screen: the card's front and back, after the parser has taken the
// schedule comment away and expanded the question

beforeAll(() => {
    setupStaticDateProvider20230906();
    unitTestSetupStandardDataStoreAlgorithm(DEFAULT_SETTINGS);
});

async function cardsOf(noteText: string) {
    const parser = createTestNoteQuestionParser(DEFAULT_SETTINGS);
    const questions = await parser.createQuestionList(
        new UnitTestSRFile(noteText),
        TextDirection.Ltr,
        TopicPath.emptyPath,
        true,
    );
    return questions.flatMap((question) => question.cards);
}

const LIST = "- [ ] The CAE\n- [x] The board\n- [ ] Management";

describe("a scheduled multiple choice card", () => {
    test("its schedule comment on its own line is not part of the explanation", async () => {
        const cards = await cardsOf(
            `#flashcards\nWhich body?\n?\n${LIST}\nWhy: the board.\n<!--SR:!2023-09-10,4,270-->\n`,
        );
        expect(cards).toHaveLength(1);
        expect(cards[0].scheduleInfo).not.toBeNull();
        const mc = parseMultipleChoice(cards[0].back);
        expect(mc?.explanation).toBe("Why: the board.");
        expect(mc?.options.map((option) => option.text)).toEqual([
            "The CAE",
            "The board",
            "Management",
        ]);
    });

    test("nor is one that follows the last line on the same line", async () => {
        const cards = await cardsOf(
            `#flashcards\nWhich body?\n?\n${LIST}\nWhy: the board. <!--SR:!2023-09-10,4,270-->\n`,
        );
        expect(parseMultipleChoice(cards[0].back)?.explanation).toBe("Why: the board.");
    });

    test("nor is one after the last option, when there is no explanation", async () => {
        const cards = await cardsOf(
            `#flashcards\nWhich body?\n?\n${LIST} <!--SR:!2023-09-10,4,270-->\n`,
        );
        const mc = parseMultipleChoice(cards[0].back);
        expect(mc?.options[2].text).toBe("Management");
        expect(mc?.explanation).toBe("");
    });

    test("a card that is not scheduled yet reads the same", async () => {
        const cards = await cardsOf(`#flashcards\nWhich body?\n?\n${LIST}\nWhy: the board.\n`);
        expect(cards[0].scheduleInfo).toBeNull();
        expect(parseMultipleChoice(cards[0].back)?.options).toHaveLength(3);
    });
});

describe("a multiple choice card written with ??", () => {
    test("makes two cards: the question with its options, and the checklist as a front", async () => {
        const cards = await cardsOf(`#flashcards\nWhich body?\n??\n${LIST}\n`);
        expect(cards).toHaveLength(2);
        expect(parseMultipleChoice(cards[0].back)).not.toBeNull();
        // The second card has the list as its front and the question as its back: an ordinary card
        expect(cards[1].front).toBe(LIST);
        expect(parseMultipleChoice(cards[1].back)).toBeNull();
    });
});
