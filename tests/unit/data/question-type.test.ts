import { CardType } from "src/data/data-structures/card/questions/question";
import {
    CardFrontBack,
    CardFrontBackUtil,
    QuestionTypeClozeFormatter,
} from "src/data/data-structures/card/questions/question-type";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { occlusionSourceOf, parseOcclusionBlock } from "src/occlusion/occlusion-block";
import { occlusionCardMarkdown } from "src/occlusion/occlusion-view";

test("CardType.SingleLineBasic", () => {
    expect(CardFrontBackUtil.expand(CardType.SingleLineBasic, "A::B", DEFAULT_SETTINGS)).toEqual([
        new CardFrontBack("A", "B"),
    ]);
});

test("CardType.SingleLineReversed", () => {
    expect(
        CardFrontBackUtil.expand(CardType.SingleLineReversed, "A:::B", DEFAULT_SETTINGS),
    ).toEqual([new CardFrontBack("A", "B"), new CardFrontBack("B", "A")]);
});

describe("CardType.MultiLineBasic", () => {
    test("Basic", () => {
        expect(
            CardFrontBackUtil.expand(
                CardType.MultiLineBasic,
                "A1\nA2\n?\nB1\nB2",
                DEFAULT_SETTINGS,
            ),
        ).toEqual([new CardFrontBack("A1\nA2", "B1\nB2")]);
    });
});

test("CardType.MultiLineReversed", () => {
    expect(
        CardFrontBackUtil.expand(
            CardType.MultiLineReversed,
            "A1\nA2\n??\nB1\nB2",
            DEFAULT_SETTINGS,
        ),
    ).toEqual([new CardFrontBack("A1\nA2", "B1\nB2"), new CardFrontBack("B1\nB2", "A1\nA2")]);
});

test("CardType.Cloze", () => {
    const clozeFormatter = new QuestionTypeClozeFormatter();

    expect(
        CardFrontBackUtil.expand(
            CardType.Cloze,
            "This is a very ==interesting== test",
            DEFAULT_SETTINGS,
        ),
    ).toEqual([
        new CardFrontBack(
            "This is a very " + clozeFormatter.asking() + " test",
            "This is a very " + clozeFormatter.showingAnswer("interesting") + " test",
        ),
    ]);

    const settings2: SRSettings = DEFAULT_SETTINGS;
    settings2.clozePatterns = [
        "==[123;;]answer[;;hint]==",
        "**[123;;]answer[;;hint]**",
        "{{[123;;]answer[;;hint]}}",
    ];

    expect(
        CardFrontBackUtil.expand(CardType.Cloze, "This is a very **interesting** test", settings2),
    ).toEqual([
        new CardFrontBack(
            "This is a very " + clozeFormatter.asking() + " test",
            "This is a very " + clozeFormatter.showingAnswer("interesting") + " test",
        ),
    ]);

    expect(
        CardFrontBackUtil.expand(CardType.Cloze, "This is a very {{interesting}} test", settings2),
    ).toEqual([
        new CardFrontBack(
            "This is a very " + clozeFormatter.asking() + " test",
            "This is a very " + clozeFormatter.showingAnswer("interesting") + " test",
        ),
    ]);

    expect(
        CardFrontBackUtil.expand(
            CardType.Cloze,
            "This is a really very {{interesting}} and ==fascinating== and **great** test",
            settings2,
        ),
    ).toEqual([
        new CardFrontBack(
            "This is a really very interesting and <span style='color:#2196f3'>[...]</span> and great test",
            "This is a really very interesting and <span style='color:#2196f3'>fascinating</span> and great test",
        ),
        new CardFrontBack(
            "This is a really very interesting and fascinating and <span style='color:#2196f3'>[...]</span> test",
            "This is a really very interesting and fascinating and <span style='color:#2196f3'>great</span> test",
        ),
        new CardFrontBack(
            "This is a really very <span style='color:#2196f3'>[...]</span> and fascinating and great test",
            "This is a really very <span style='color:#2196f3'>interesting</span> and fascinating and great test",
        ),
    ]);
});

describe("CardType.ImageOcclusion", () => {
    const block =
        "```image-occlusion\nimage: [[h.png]]\nmask: a rect 0 0 .5 .5 | A\nmask: b rect .5 .5 .5 .5 | B\n```";

    const parsed = parseOcclusionBlock(occlusionSourceOf(block));

    test("one card per mask, in mask order", () => {
        expect(CardFrontBackUtil.expand(CardType.ImageOcclusion, block, DEFAULT_SETTINGS)).toEqual([
            new CardFrontBack(
                occlusionCardMarkdown(parsed, 0, "front"),
                occlusionCardMarkdown(parsed, 0, "back"),
            ),
            new CardFrontBack(
                occlusionCardMarkdown(parsed, 1, "front"),
                occlusionCardMarkdown(parsed, 1, "back"),
            ),
        ]);
    });

    test("a block that does not parse makes no cards", () => {
        expect(
            CardFrontBackUtil.expand(
                CardType.ImageOcclusion,
                "```image-occlusion\nnothing\n```",
                DEFAULT_SETTINGS,
            ),
        ).toEqual([]);
        expect(
            CardFrontBackUtil.expand(CardType.ImageOcclusion, "plain text", DEFAULT_SETTINGS),
        ).toEqual([]);
    });
});
