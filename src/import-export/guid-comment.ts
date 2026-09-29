import { cyrb53 } from "src/utils/strings";

/**
 * Imported cards remember the Anki note they came from in an HTML comment on the line after the card:
 *
 *     Question::Answer
 *     <!--anki:i%3EWU5liws]-->
 *
 * A later import finds these comments to skip notes it already imported. The plugin's parser skips every line that
 * starts with `<!--` (except its own `<!--SR:` scheduling comments), and rewriting a card's schedule leaves
 * neighbouring lines alone, so the comment is invisible to reviewing.
 */
const GUID_COMMENT_FINDER = /<!--anki:(.*?)-->/g;

/**
 * Anki guids are drawn from a 91 character alphabet that includes `<`, `>` and `-`, so a guid could contain `-->` and
 * end the comment early. Percent-encoding everything except letters, digits and a few safe symbols rules that out.
 */
export function encodeGuid(guid: string): string {
    return encodeURIComponent(guid).replace(
        /[-!'()*~.]/g,
        (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
    );
}

export function decodeGuid(encoded: string): string {
    try {
        return decodeURIComponent(encoded);
    } catch {
        return encoded;
    }
}

export function formatGuidComment(guid: string): string {
    return `<!--anki:${encodeGuid(guid)}-->`;
}

/** Every Anki guid recorded in a note's text. */
export function findGuids(text: string): string[] {
    return Array.from(text.matchAll(GUID_COMMENT_FINDER), (match) => decodeGuid(match[1]));
}

/** A stable id for a note that has none, such as a row of a text file: the same deck and first field give the same id. */
export function syntheticGuid(deck: string, firstField: string): string {
    return "csv-" + cyrb53(deck + "\u001f" + firstField);
}
