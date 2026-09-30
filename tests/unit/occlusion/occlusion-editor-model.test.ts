import type { OcclusionBlock } from "src/occlusion/occlusion-block";
import { OcclusionEditorModel } from "src/occlusion/occlusion-editor-model";

const block: OcclusionBlock = {
    image: "[[x.png]]",
    mode: "hide-all",
    question: "Which one?",
    masks: [
        { id: "a", shape: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: "A" },
        { id: "b", shape: "ellipse", x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: "B" },
        { id: "c", shape: "rect", x: 0.7, y: 0.1, w: 0.2, h: 0.2, label: "C" },
    ],
};

describe("OcclusionEditorModel", () => {
    test("an unchanged block comes back as it was, every mask at its old index", () => {
        const model = new OcclusionEditorModel(block);
        expect(model.result()).toEqual({ block, oldIndexOfNew: [0, 1, 2] });
    });

    test("deleting a mask leaves the others with their own old index", () => {
        const model = new OcclusionEditorModel(block);
        model.select(1);
        expect(model.removeSelected()).toBe(true);
        const { block: after, oldIndexOfNew } = model.result();
        expect(after.masks.map((m) => m.id)).toEqual(["a", "c"]);
        expect(oldIndexOfNew).toEqual([0, 2]);
        expect(model.selected).toBe(-1);
    });

    test("a new mask has no old index, with the shape that is chosen, and is selected", () => {
        const model = new OcclusionEditorModel(block);
        model.shape = "ellipse";
        const index = model.addMask({ x: 0.3, y: 0.4, w: 0.1, h: 0.2 });
        expect(index).toBe(3);
        expect(model.selected).toBe(3);
        const { block: after, oldIndexOfNew } = model.result();
        expect(after.masks[3]).toMatchObject({
            shape: "ellipse",
            x: 0.3,
            y: 0.4,
            w: 0.1,
            h: 0.2,
            label: "",
        });
        expect(["a", "b", "c"]).not.toContain(after.masks[3].id);
        expect(oldIndexOfNew).toEqual([0, 1, 2, null]);
    });

    test("delete then add: the new mask does not take over the schedule of the deleted one", () => {
        const model = new OcclusionEditorModel(block);
        model.select(0);
        model.removeSelected();
        model.addMask({ x: 0, y: 0, w: 0.5, h: 0.5 });
        expect(model.result().oldIndexOfNew).toEqual([1, 2, null]);
    });

    test("labels, moves, the mode and the question are part of the result", () => {
        const model = new OcclusionEditorModel(block);
        model.select(2);
        model.setLabel("Charlie");
        model.setRect(2, { x: 0.6, y: 0.6, w: 0.3, h: 0.3 });
        model.mode = "hide-one";
        model.question = "New question";
        const { block: after } = model.result();
        expect(after.masks[2]).toMatchObject({ label: "Charlie", x: 0.6, y: 0.6, w: 0.3, h: 0.3 });
        expect(after.mode).toBe("hide-one");
        expect(after.question).toBe("New question");
        expect(after.image).toBe("[[x.png]]");
    });

    test("with nothing selected, there is nothing to name or delete", () => {
        const model = new OcclusionEditorModel(block);
        model.setLabel("ignored");
        expect(model.removeSelected()).toBe(false);
        expect(model.result().block).toEqual(block);
    });

    test("select ignores an index that is not a mask", () => {
        const model = new OcclusionEditorModel(block);
        model.select(7);
        expect(model.selected).toBe(-1);
    });

    test("the block that is given is not changed by editing", () => {
        const model = new OcclusionEditorModel(block);
        model.select(0);
        model.setLabel("changed");
        expect(block.masks[0].label).toBe("A");
    });
});
