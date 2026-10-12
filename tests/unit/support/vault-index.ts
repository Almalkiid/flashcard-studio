import { BuriedCards } from "src/data/data-structures/card/buried-cards";
import { StudioSettings } from "src/data/settings-model";
import { VaultIndex } from "src/data/vault-core";
import { NoteReviewQueue } from "src/note-review/note-review-queue";
import { TextDirection } from "src/utils/text";

/** An VaultIndex over nothing: no notes, no links, the parts it needs made up. Built, then started again by `initUnitTestCore`. */
export class UnitTestVaultIndex extends VaultIndex {
    constructor(settings: StudioSettings) {
        const parts = [
            new BuriedCards(null, settings, []),
            { getResolvedTargetLinksForNotePath: () => ({}) },
            settings,
            () => Promise.resolve(),
            new NoteReviewQueue(),
            TextDirection.Ltr,
        ] as const;
        super(...parts);
        this.initUnitTestCore(...parts);
    }
}
