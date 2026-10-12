import "src/ui/obsidian-ui-components/content-container/card-container/context-section/context-line.css";

import { Question } from "src/data/data-structures/card/question";
import { Note } from "src/note-review/note";

/** `[[target|alias]]` reads as its alias, `[[target]]` as its target; the rest of the heading stays as it is. */
function unwrapLinks(heading: string): string {
    return heading.replace(
        /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g,
        (_match, target: string, alias: string | undefined) => alias ?? target,
    );
}

/** The line above a card that says where it came from: the note, then the headings the card sits under. */
export default class ContextSectionComponent {
    private readonly contextEl: HTMLDivElement;

    constructor(parentEl: HTMLElement) {
        this.contextEl = parentEl.createDiv({ cls: "fs-context" });
    }

    public updateCardContext(show: boolean, question: Question, note: Note): void {
        this.contextEl.toggleClass("fs-is-hidden", !show);
        if (!show) {
            this.contextEl.setText("");
            return;
        }
        const headings = question.questionContext.map((heading) => ` > ${unwrapLinks(heading)}`);
        this.contextEl.setText(` ${note.file.basename}${headings.join("")}`);
    }
}
