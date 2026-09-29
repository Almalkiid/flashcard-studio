import { ClozeCrafter, ClozeTypeEnum } from "clozecraft";
import { ClozePattern } from "clozecraft/dist/implementation/ClozePattern";

/**
 * Rewrites the cloze deletions of a card, written in any of the cloze patterns of the settings, as Anki clozes:
 * `{{c1::answer::hint}}`.
 *
 * The numbers follow the cards the plugin makes of the text, so an exported cloze note has the same cards. A cloze
 * that is asked on several cards (an overlapping cloze) is written with nested clozes, `{{c1::{{c2::answer}}}}`,
 * which every Anki since 2.1.56 shows right. The shorter `{{c1,2::answer}}` is only in the newest Anki versions:
 * Anki 25.9 shows it as text and makes no card for the second number. Anki cannot hide a cloze on some cards and
 * only show it on others, so that part of an overlapping cloze is lost.
 *
 * @returns The text with Anki clozes, or null when the text is not a cloze note under these patterns.
 */
export function convertClozesToAnki(text: string, patterns: string[]): string | null {
    let note;
    let compiled: ClozePattern[];
    try {
        note = new ClozeCrafter(patterns).createClozeNote(text);
        compiled = patterns.map((pattern) => new ClozePattern(pattern));
    } catch {
        return null;
    }
    if (note === null) return null;

    const type = note.clozeType;
    let result = text;
    let simpleNumber = 0;
    for (const pattern of compiled) {
        const regex = pattern.getClozeRegex(type);
        for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
            let numbers: number[];
            if (type === ClozeTypeEnum.SIMPLE) {
                // Text without numbers: each cloze is the next card, in the order the plugin finds them
                numbers = [++simpleNumber];
            } else if (type === ClozeTypeEnum.CLASSIC) {
                numbers = [Number(match.seq)];
            } else {
                numbers = Array.from(String(match.seq)).flatMap((action, index) =>
                    action === "a" ? [index + 1] : [],
                );
            }
            const hint = match.hint ? `::${match.hint}` : "";
            // The innermost cloze holds the answer and the hint, the others wrap it
            const replacement = numbers.reduceRight(
                (inner, number, index) =>
                    index === numbers.length - 1
                        ? `{{c${number}::${inner}${hint}}}`
                        : `{{c${number}::${inner}}}`,
                match.answer,
            );
            // A function, so that `$` in the text is not read as a replacement pattern
            result = result.replace(match.raw, () => replacement);
        }
    }
    return result;
}
