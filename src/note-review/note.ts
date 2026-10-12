import type { Question } from "src/data/data-structures/card/question";
import type { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import type { Deck } from "src/data/decks/deck";
import type { StudioSettings } from "src/data/settings-model";

export class Note {
    constructor(
        public file: IVaultNoteFile,
        public questionList: Question[],
    ) {
        for (const question of questionList) question.note = this;
    }

    get hasChanged(): boolean {
        return this.questionList.some(({ hasChanged }) => hasChanged);
    }

    get filePath(): string {
        return this.file.path;
    }

    appendCardsToDeck(deck: Deck): void {
        const placements = this.questionList.flatMap((question) =>
            question.cards.map((card) => [question.topicPathList, card] as const),
        );
        for (const [paths, card] of placements) deck.appendReviewItem(paths, card);
    }

    /** Rewrites the questions marked changed, in one read-and-write step; a note whose text stays the same is not written. */
    async writeNoteFile(settings: StudioSettings): Promise<void> {
        const changed = this.questionList.filter((question) => question.hasChanged);
        await this.file.edit((text) => {
            const updated = changed.reduce(
                (current, question) => question.updateQuestionWithinNoteText(current, settings),
                text,
            );
            return updated === text ? null : updated;
        });
        for (const question of this.questionList) question.hasChanged = false;
    }
}
