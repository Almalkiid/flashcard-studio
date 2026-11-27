/**
 * The guide's image cloze example is what people copy: read as a note, it must make what the guide says it makes, one
 * question in which the text clozes and the masks share card numbers. (0.23.0 shipped it with a blank line before the
 * block, which prettier had put there, so a copy made two separate questions.)
 */
import { readFileSync } from "fs";
import * as path from "path";

import { CardFrontBackUtil } from "src/cards/expand";
import { parse, parserOptionsFromSettings } from "src/cards/parse";
import { CardType } from "src/data/data-structures/card/question";
import { cloneDefaultSettings } from "src/data/settings-model";

const guide = readFileSync(
    path.resolve(__dirname, "../../../docs/docs/image-occlusion.md"),
    "utf8",
);

/** The first ````markdown example after the "Image cloze" heading. */
function example(): string {
    const section = guide.slice(guide.indexOf("## Image cloze"));
    const match = /````markdown\n([\s\S]*?)\n````/.exec(section);
    if (match === null) throw new Error("the guide has no image cloze example");
    return match[1];
}

test("the guide's example is one question: text clozes and masks share card numbers", () => {
    const settings = cloneDefaultSettings();
    const questions = parse(example(), parserOptionsFromSettings(settings));
    expect(questions.map((q) => CardType[q.cardType])).toEqual(["Cloze"]);
    const cards = CardFrontBackUtil.expand(CardType.Cloze, questions[0].text, settings);
    // Text clozes 1 and 2; masks 1 and 2; `ash` is asked on card 1 only (shown on 2, hidden on 3): cards 1 and 2
    expect(cards.map((card) => card.cardNumber)).toEqual([1, 2]);
});
