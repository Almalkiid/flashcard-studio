import {
    maskStates,
    occlusionCardMarkdown,
    parseOcclusionCardSpec,
    plainLabel,
} from "src/occlusion/occlusion-view";

const block = {
    image: "x.png",
    mode: "hide-all" as const,
    question: "",
    masks: [
        { id: "a", shape: "rect" as const, x: 0, y: 0, w: 0.1, h: 0.1, label: "A" },
        { id: "b", shape: "rect" as const, x: 0.5, y: 0.5, w: 0.1, h: 0.1, label: "B" },
        { id: "c", shape: "ellipse" as const, x: 0.2, y: 0.7, w: 0.1, h: 0.1, label: "" },
    ],
};

test("hide all: the active mask is highlighted, the others are hidden, front and back", () => {
    expect(maskStates({ block, active: 1, side: "front" })).toEqual([
        "hidden",
        "hidden-active",
        "hidden",
    ]);
    expect(maskStates({ block, active: 1, side: "back" })).toEqual([
        "hidden",
        "revealed",
        "hidden",
    ]);
});
test("hide one: only the active mask is drawn", () => {
    const one = { ...block, mode: "hide-one" as const };
    expect(maskStates({ block: one, active: 0, side: "front" })).toEqual([
        "hidden-active",
        "none",
        "none",
    ]);
    expect(maskStates({ block: one, active: 0, side: "back" })).toEqual([
        "revealed",
        "none",
        "none",
    ]);
});
test("the card markdown round-trips", () => {
    const md = occlusionCardMarkdown(block, 2, "back");
    expect(md.startsWith("```fs-occlusion-card\n")).toBe(true);
    expect(parseOcclusionCardSpec(md.slice(md.indexOf("\n") + 1, md.lastIndexOf("\n```")))).toEqual(
        { block, active: 2, side: "back" },
    );
});

describe("the card markdown, whatever the labels hold", () => {
    const tricky = {
        ...block,
        masks: [{ ...block.masks[0], label: '``` ~~~ `code` and </pre> \\ "quotes" | pipe' }],
    };
    test("stays one fenced block on lines of its own", () => {
        const md = occlusionCardMarkdown(tricky, 0, "front");
        expect(md.split("\n")).toHaveLength(3);
        expect(md.slice(md.indexOf("\n") + 1, md.lastIndexOf("\n```"))).not.toContain("`");
    });
    test("gives the label back unchanged", () => {
        const md = occlusionCardMarkdown(tricky, 0, "front");
        const spec = parseOcclusionCardSpec(
            md.slice(md.indexOf("\n") + 1, md.lastIndexOf("\n```")),
        );
        expect(spec?.block.masks[0].label).toBe(tricky.masks[0].label);
    });
});

describe("parseOcclusionCardSpec, for a block that was typed by hand", () => {
    const good = { block, active: 0, side: "front" };
    test.each([
        ["not JSON", "{oops"],
        ["not an object", "5"],
        ["null", "null"],
        ["no block", JSON.stringify({ active: 0, side: "front" })],
        ["a block without masks", JSON.stringify({ ...good, block: { ...block, masks: [] } })],
        ["a block that is not an object", JSON.stringify({ ...good, block: "x" })],
        ["masks that are not a list", JSON.stringify({ ...good, block: { ...block, masks: 3 } })],
        ["an image that is not text", JSON.stringify({ ...good, block: { ...block, image: 3 } })],
        ["an active index past the masks", JSON.stringify({ ...good, active: 3 })],
        ["a negative active index", JSON.stringify({ ...good, active: -1 })],
        ["a fractional active index", JSON.stringify({ ...good, active: 0.5 })],
        ["an unknown side", JSON.stringify({ ...good, side: "middle" })],
    ])("%s is not a card", (_name, source) => {
        expect(parseOcclusionCardSpec(source)).toBeNull();
    });
});

describe("plainLabel", () => {
    test("drops the Markdown that would show as symbols inside a mask", () => {
        expect(plainLabel("Left **ventricle**")).toBe("Left ventricle");
        expect(plainLabel("_a_ and *b* and ==c== and ~~d~~ and `e`")).toBe(
            "a and b and c and d and e",
        );
        expect(plainLabel("[[Note|the note]] and [[Other]] and [text](http://x.y)")).toBe(
            "the note and Other and text",
        );
        expect(plainLabel("plain")).toBe("plain");
    });
});
