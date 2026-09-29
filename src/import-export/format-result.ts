import { ExportSummary } from "src/import-export/anki-exporter";
import { ImportResult } from "src/import-export/anki-importer";
import { IBaseLocale } from "src/lang/base-locale";
import { t } from "src/lang/helpers";

/** The words of a message for the user: a headline, and lines with more that only matter sometimes. */
export interface Summary {
    headline: string;
    details: string[];
}

/** A count with its unit, for example `1 card` or `839 cards`. The unit text has both forms: `card|cards`. */
export function countOf(count: number, unitKey: keyof IBaseLocale): string {
    const [one, many] = t(unitKey).split("|");
    return `${count} ${count === 1 ? one : many}`;
}

/** Names for a message, the first few of them. */
function nameList(names: string[], shown = 5): string {
    const more = names.length > shown ? `, +${names.length - shown}` : "";
    return names.slice(0, shown).join(", ") + more;
}

/** What to tell the user after an import. */
export function summariseImport(
    result: ImportResult,
    targetFolder: string,
    clozePatternAdded: boolean,
): Summary {
    const cards = countOf(result.cards, "ANKI_UNIT_CARDS");
    const decks = countOf(result.decks, "ANKI_UNIT_DECKS");
    const headline =
        result.mediaFiles > 0
            ? t("ANKI_IMPORT_RESULT_WITH_MEDIA", {
                  cards,
                  decks,
                  media: countOf(result.mediaFiles, "ANKI_UNIT_MEDIA"),
              })
            : t("ANKI_IMPORT_RESULT", { cards, decks });

    const details: string[] = [];
    if (result.duplicates > 0) {
        details.push(
            t("ANKI_IMPORT_RESULT_DUPLICATES", {
                duplicates: countOf(result.duplicates, "ANKI_UNIT_DUPLICATES"),
            }),
        );
    }
    if (result.skipped > 0) {
        details.push(
            t("ANKI_IMPORT_RESULT_SKIPPED", {
                skipped: countOf(result.skipped, "ANKI_UNIT_CARDS"),
            }),
        );
    }
    if (result.missingMedia.length > 0) {
        details.push(
            t("ANKI_IMPORT_RESULT_MISSING_MEDIA", { names: nameList(result.missingMedia) }),
        );
    }
    if (result.hasClozes) details.push(t("ANKI_IMPORT_RESULT_CLOZE"));
    if (clozePatternAdded) details.push(t("ANKI_IMPORT_CLOZE_PATTERN_ADDED"));
    if (result.cards > 0)
        details.push(t("ANKI_IMPORT_RESULT_FOLDER", { folder: targetFolder || "/" }));
    return { headline, details };
}

/** What to tell the user after an export. */
export function summariseExport(summary: ExportSummary, skipped: number, path: string): Summary {
    const cards = countOf(summary.cards, "ANKI_UNIT_CARDS");
    const decks = countOf(summary.decks, "ANKI_UNIT_DECKS");
    const headline =
        summary.mediaFiles > 0
            ? t("ANKI_EXPORT_RESULT_WITH_MEDIA", {
                  cards,
                  decks,
                  media: countOf(summary.mediaFiles, "ANKI_UNIT_MEDIA"),
                  path,
              })
            : t("ANKI_EXPORT_RESULT", { cards, decks, path });

    const details: string[] = [];
    if (skipped > 0) {
        details.push(t("ANKI_EXPORT_SKIPPED", { skipped: countOf(skipped, "ANKI_UNIT_CARDS") }));
    }
    if (summary.missingMedia.length > 0) {
        details.push(
            t("ANKI_EXPORT_RESULT_MISSING_MEDIA", { names: nameList(summary.missingMedia) }),
        );
    }
    return { headline, details };
}
