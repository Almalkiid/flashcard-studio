import { DEFAULT_SETTINGS } from "src/data/settings";
import type { OcclusionBlock } from "src/occlusion/occlusion-block";
import {
    emptyScheduleSegment,
    insertOcclusionBlock,
    locateOcclusionBlock,
    remapScheduleComment,
    replaceOcclusionBlock,
} from "src/occlusion/occlusion-rewrite";
import { SRAlgorithmType } from "src/scheduling/algorithms/base/isr-algorithm";
import { FSRS_EMPTY_SCHEDULE_COMMENT } from "src/scheduling/algorithms/fsrs/fsrs-helpers";

const E = "fsrs,EMPTY";
describe("remapScheduleComment", () => {
    const c = "<!--SR:!fsrs,A,id=aaa!fsrs,B,id=bbb!fsrs,C,id=ccc-->";
    test("deleting the middle mask drops its schedule, the others keep theirs", () => {
        expect(remapScheduleComment(c, [0, 2], E)).toBe("<!--SR:!fsrs,A,id=aaa!fsrs,C,id=ccc-->");
    });
    test("reordering moves schedules with their masks", () => {
        expect(remapScheduleComment(c, [2, 0, 1], E)).toBe(
            "<!--SR:!fsrs,C,id=ccc!fsrs,A,id=aaa!fsrs,B,id=bbb-->",
        );
    });
    test("a new mask gets an empty slot", () => {
        expect(remapScheduleComment(c, [0, null, 1, 2], E)).toBe(
            "<!--SR:!fsrs,A,id=aaa!fsrs,EMPTY!fsrs,B,id=bbb!fsrs,C,id=ccc-->",
        );
    });
    test("no comment stays no comment", () => {
        expect(remapScheduleComment(null, [null, null], E)).toBeNull();
    });
    test("an old index beyond the comment's segments is an empty slot", () => {
        expect(remapScheduleComment("<!--SR:!fsrs,A-->", [0, 1], E)).toBe(
            "<!--SR:!fsrs,A!fsrs,EMPTY-->",
        );
    });
    test("nothing of the old schedules is left: no comment at all", () => {
        expect(remapScheduleComment(c, [null, null], E)).toBeNull();
        expect(remapScheduleComment(c, [], E)).toBeNull();
    });
    test("an empty slot that was already in the comment is kept, with its tokens", () => {
        expect(remapScheduleComment("<!--SR:!fsrs,-,0,id=x,susp!fsrs,B-->", [1, 0], E)).toBe(
            "<!--SR:!fsrs,B!fsrs,-,0,id=x,susp-->",
        );
    });
    test("SM-2 comments are moved the same way", () => {
        expect(
            remapScheduleComment(
                "<!--SR:!2023-09-03,1,230!2023-09-05,4,250-->",
                [1],
                "2000-01-01,1,250",
            ),
        ).toBe("<!--SR:!2023-09-05,4,250-->");
    });
    test("text that is not a schedule comment is returned as it was", () => {
        expect(remapScheduleComment("not a comment", [0], E)).toBe("not a comment");
    });
});

describe("replaceOcclusionBlock", () => {
    const note =
        "Intro\n\n```image-occlusion\nimage: x.png\nmask: a rect 0 0 .5 .5 | A\nmask: b rect .5 .5 .5 .5 | B\n```\n<!--SR:!fsrs,A!fsrs,B-->\n\nQ::A";
    const b: OcclusionBlock = {
        image: "x.png",
        mode: "hide-all",
        question: "",
        masks: [{ id: "b", shape: "rect", x: 0.5, y: 0.5, w: 0.5, h: 0.5, label: "B" }],
    };

    test("rewrites the block and its comment and leaves the rest byte-identical", () => {
        const out = replaceOcclusionBlock(note, 2, b, [1], E);
        expect(out).toBe(
            "Intro\n\n```image-occlusion\nimage: x.png\nmode: hide-all\nmask: b rect 0.5000 0.5000 0.5000 0.5000 | B\n```\n<!--SR:!fsrs,B-->\n\nQ::A",
        );
    });

    test("a block that was never reviewed has no comment to change, and gets none", () => {
        const fresh = "```image-occlusion\nimage: x.png\nmask: a rect 0 0 .5 .5 | A\n```\n\nafter";
        expect(replaceOcclusionBlock(fresh, 0, b, [null], E)).toBe(
            "```image-occlusion\nimage: x.png\nmode: hide-all\nmask: b rect 0.5000 0.5000 0.5000 0.5000 | B\n```\n\nafter",
        );
    });

    test("a comment that is not directly under the block is not the block's", () => {
        const apart =
            "```image-occlusion\nimage: x.png\nmask: a rect 0 0 .5 .5 | A\n```\n\n<!--SR:!fsrs,A-->";
        expect(
            replaceOcclusionBlock(apart, 0, b, [0], E).endsWith("```\n\n<!--SR:!fsrs,A-->"),
        ).toBe(true);
    });

    test("when no schedule is left the comment line goes", () => {
        expect(replaceOcclusionBlock(note, 2, b, [null], E)).toBe(
            "Intro\n\n```image-occlusion\nimage: x.png\nmode: hide-all\nmask: b rect 0.5000 0.5000 0.5000 0.5000 | B\n```\n\nQ::A",
        );
    });

    test("the schedule in a metadata callout is moved too, and the callout stays", () => {
        const callout =
            "```image-occlusion\nimage: x.png\nmask: a rect 0 0 .5 .5 | A\nmask: b rect .5 .5 .5 .5 | B\n```\n> [!sr|card-metadata] \n>  <!--SR:!fsrs,A!fsrs,B-->\nnext";
        expect(replaceOcclusionBlock(callout, 0, b, [1], E)).toBe(
            "```image-occlusion\nimage: x.png\nmode: hide-all\nmask: b rect 0.5000 0.5000 0.5000 0.5000 | B\n```\n> [!sr|card-metadata] \n>  <!--SR:!fsrs,B-->\nnext",
        );
    });

    test("a tilde block, Windows line endings and an indent are kept", () => {
        const crlf =
            "- item\r\n  ~~~image-occlusion\r\n  image: x.png\r\n  mask: a rect 0 0 .5 .5 | A\r\n  ~~~\r\n<!--SR:!fsrs,A-->\r\nend";
        expect(replaceOcclusionBlock(crlf, 1, b, [0], E)).toBe(
            "- item\r\n  ~~~image-occlusion\r\n  image: x.png\r\n  mode: hide-all\r\n  mask: b rect 0.5000 0.5000 0.5000 0.5000 | B\r\n  ~~~\r\n<!--SR:!fsrs,A-->\r\nend",
        );
    });

    test("a fence that is not an occlusion block, or is not closed, changes nothing", () => {
        expect(replaceOcclusionBlock(note, 0, b, [0], E)).toBe(note);
        expect(replaceOcclusionBlock(note, 99, b, [0], E)).toBe(note);
        const open = "```image-occlusion\nimage: x.png";
        expect(replaceOcclusionBlock(open, 0, b, [0], E)).toBe(open);
    });
});

describe("insertOcclusionBlock", () => {
    test("is the fenced block with a line break after it", () => {
        expect(
            insertOcclusionBlock({
                image: "[[x.png]]",
                mode: "hide-one",
                question: "What?",
                masks: [{ id: "a1", shape: "ellipse", x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: "" }],
            }),
        ).toBe(
            "```image-occlusion\nimage: [[x.png]]\nmode: hide-one\nquestion: What?\nmask: a1 ellipse 0.1000 0.2000 0.3000 0.4000 |\n```\n",
        );
    });
});

describe("emptyScheduleSegment", () => {
    test("is the placeholder that formatCardSchedule writes for a card that was never reviewed", () => {
        expect(emptyScheduleSegment({ ...DEFAULT_SETTINGS, algorithm: SRAlgorithmType.FSRS })).toBe(
            FSRS_EMPTY_SCHEDULE_COMMENT.slice(1),
        );
        expect(
            emptyScheduleSegment({
                ...DEFAULT_SETTINGS,
                algorithm: SRAlgorithmType.SM_2_OSR,
                baseEase: 250,
            }),
        ).toBe("2000-01-01,1,250");
    });
});

describe("locateOcclusionBlock", () => {
    const block = (image: string, label: string) =>
        `\`\`\`image-occlusion\nimage: ${image}\nmask: a rect 0 0 .5 .5 | ${label}\n\`\`\``;
    const mine: OcclusionBlock = {
        image: "x.png",
        mode: "hide-all",
        question: "",
        masks: [{ id: "a", shape: "rect", x: 0, y: 0, w: 0.5, h: 0.5, label: "A" }],
    };

    test("is the line it was on, when the block there still has its content", () => {
        expect(locateOcclusionBlock("Intro\n\n" + block("x.png", "A") + "\nend", 2, mine)).toBe(2);
    });
    test("finds the block by its content when the note changed above it", () => {
        expect(locateOcclusionBlock("One\nTwo\nThree\n\n" + block("x.png", "A"), 2, mine)).toBe(4);
    });
    test("a different block on that line is not this block", () => {
        const note = block("y.png", "Other") + "\n\n" + block("x.png", "A");
        expect(locateOcclusionBlock(note, 0, mine)).toBe(5);
    });
    test("is not found when the block was changed, or is gone", () => {
        expect(locateOcclusionBlock(block("x.png", "A changed"), 0, mine)).toBe("not-found");
        expect(locateOcclusionBlock("Nothing here\n", 0, mine)).toBe("not-found");
        expect(locateOcclusionBlock(block("y.png", "Other"), 0, mine)).toBe("not-found");
    });
    test("is ambiguous when the note has the same block twice and neither is on that line", () => {
        const note = "Added\n\n" + block("x.png", "A") + "\n\n" + block("x.png", "A");
        expect(locateOcclusionBlock(note, 0, mine)).toBe("ambiguous");
        // but a copy on the very line it was on is the one that was opened
        expect(locateOcclusionBlock(note, 2, mine)).toBe(2);
        expect(locateOcclusionBlock(note, 7, mine)).toBe(7);
    });
    test("blocks that are not closed, and other code blocks, are not looked at", () => {
        expect(
            locateOcclusionBlock("```image-occlusion\nimage: x.png\n\n```js\nx\n```", 0, mine),
        ).toBe("not-found");
    });
    test("compares the content, not how it was written", () => {
        const spaced = "```image-occlusion\nIMAGE:  x.png\nmask: a  rect 0 0 .5 .5 |  A\n```";
        expect(locateOcclusionBlock("\n" + spaced, 5, mine)).toBe(1);
    });
});
