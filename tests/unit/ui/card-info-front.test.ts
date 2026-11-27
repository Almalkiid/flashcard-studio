import { parseImageClozeBlock } from "src/occlusion/image-cloze-block";
import { imageClozeCardMarkdown } from "src/occlusion/image-cloze-view";
import { cardInfoFrontText } from "src/ui/obsidian-ui-components/modals/card-info-modal";

const hint = "h".repeat(200);
const read = parseImageClozeBlock(`image: x.png\nmask: 1 | a rect 0 0 .1 .1 | ${hint}`);
if (!read.ok) throw new Error("not read");
const spec = imageClozeCardMarkdown({
    kind: "cloze",
    block: read.block,
    card: 1,
    side: "front",
    textCards: 1,
});

test("a card of text and image: the text, the picture as its hints, in full", () => {
    expect(cardInfoFrontText(`The [...] pumps.\n${spec}`)).toBe(
        `The [...] pumps. [image: ${hint}]`,
    );
});

test("other cards are cut as before", () => {
    expect(cardInfoFrontText("x".repeat(200))).toHaveLength(141);
    expect(cardInfoFrontText("**bold** text")).toBe("bold text");
});
