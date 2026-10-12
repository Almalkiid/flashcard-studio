/**
 * Rule 6 machine check: the functions the settings rebuild reuses must still exist where the plan says they are.
 */
import { setDebugParser } from "src/cards/parse";
import { normalizeCalloutTypes } from "src/data/data-structures/card/questions/callout-card";
import { importLegacySettings } from "src/data/legacy-settings-migration";
import { setClozeMathMacro } from "src/math/cloze-macro";
import {
    formatFsrsSteps,
    formatFsrsWeights,
    hasStepOfADayOrMore,
    parseFsrsSteps,
    parseFsrsWeights,
} from "src/scheduling/fsrs/fsrs-settings";
import { desktopTabWanted } from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";
import { speechAvailable, VoiceWatcher } from "src/ui/speech";

const PRIOR_ART = {
    "src/scheduling/fsrs/fsrs-settings.ts": [
        parseFsrsSteps,
        formatFsrsSteps,
        hasStepOfADayOrMore,
        parseFsrsWeights,
        formatFsrsWeights,
    ],
    "src/data/data-structures/card/questions/callout-card.ts": [normalizeCalloutTypes],
    "src/data/legacy-settings-migration.ts": [importLegacySettings],
    "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell.ts": [desktopTabWanted],
    "src/math/cloze-macro.ts": [setClozeMathMacro],
    "src/ui/speech.ts": [speechAvailable, VoiceWatcher],
    "src/parser.ts": [setDebugParser],
};

test.each(Object.entries(PRIOR_ART))("%s still exports what the settings reuse", (_file, fns) => {
    for (const fn of fns) expect(typeof fn).toBe("function");
});
