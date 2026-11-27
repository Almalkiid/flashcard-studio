import type { App } from "obsidian";

import { BLOCK_KINDS, BlockKindSuggestModal } from "src/occlusion/image-suggest-modal";

test("the add command offers Answers first, as it made before, then Cloze cards", () => {
    expect(BLOCK_KINDS).toEqual(["answers", "cloze"]);
    const chosen: string[] = [];
    const modal = new BlockKindSuggestModal({} as App, (kind) => chosen.push(kind));
    expect(modal.getItems().map((kind) => modal.getItemText(kind))).toEqual([
        "Answers: one card per mask, with its answer",
        "Cloze cards: masks asked by card number, with hints",
    ]);
    modal.onChooseItem("cloze");
    expect(chosen).toEqual(["cloze"]);
});
