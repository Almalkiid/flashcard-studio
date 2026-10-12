import { IClozeFormatter } from "clozecraft";

import { CardType } from "src/data/data-structures/card/question";
import { splitCalloutCard } from "src/data/data-structures/card/questions/callout-card";
import { StudioSettings } from "src/data/settings-model";
import { createClozeNote } from "src/math/math-cloze";
import { occlusionSourceOf, parseOcclusionBlock } from "src/occlusion/occlusion-block";
import { occlusionCardMarkdown } from "src/occlusion/occlusion-view";
import { findLineIndexOfSearchStringIgnoringWs } from "src/utils/text";

export class CardFrontBack {
    constructor(
        public front: string,
        public back: string,
    ) {}
}

export interface IQuestionTypeHandler {
    expand(questionText: string, settings: StudioSettings): CardFrontBack[];
}

type SeparatorOf = (settings: StudioSettings) => string;

/** The card, plus its mirror image when the card is reversed. */
function withMirror(front: string, back: string, reversed: boolean): CardFrontBack[] {
    const forward = new CardFrontBack(front, back);
    return reversed ? [forward, new CardFrontBack(back, front)] : [forward];
}

/** `question::answer` on one line. */
class SingleLine implements IQuestionTypeHandler {
    constructor(
        private readonly separatorOf: SeparatorOf,
        private readonly reversed: boolean,
    ) {}

    expand(text: string, settings: StudioSettings): CardFrontBack[] {
        const mark = this.separatorOf(settings);
        const cut = text.indexOf(mark);
        return withMirror(text.substring(0, cut), text.substring(cut + mark.length), this.reversed);
    }
}

/** A question over several lines, a line with the separator, the answer under it. */
class Multiline implements IQuestionTypeHandler {
    constructor(
        private readonly separatorOf: SeparatorOf,
        private readonly reversed: boolean,
    ) {}

    expand(text: string, settings: StudioSettings): CardFrontBack[] {
        const lines = text.split("\n");
        const cut = findLineIndexOfSearchStringIgnoringWs(lines, this.separatorOf(settings));
        const [front, back] = [lines.slice(0, cut), lines.slice(cut + 1)].map((part) =>
            part.join("\n"),
        );
        return withMirror(front, back, this.reversed);
    }
}

class Callout implements IQuestionTypeHandler {
    expand(text: string): CardFrontBack[] {
        const parts = splitCalloutCard(text);
        return parts ? [new CardFrontBack(parts.front, parts.back)] : [];
    }
}

class ImageOcclusion implements IQuestionTypeHandler {
    expand(text: string): CardFrontBack[] {
        const source = occlusionSourceOf(text);
        const block = source && parseOcclusionBlock(source);
        if (!block) return [];
        return block.masks.map(
            (_mask, index) =>
                new CardFrontBack(
                    occlusionCardMarkdown(block, index, "front"),
                    occlusionCardMarkdown(block, index, "back"),
                ),
        );
    }
}

class Cloze implements IQuestionTypeHandler {
    expand(text: string, settings: StudioSettings): CardFrontBack[] {
        const withInputs = settings.convertClozePatternsToInputs || settings.typeAnswers;
        const style: IClozeFormatter = withInputs
            ? new QuestionTypeClozeInputFormatter()
            : new QuestionTypeClozeFormatter();
        const made = createClozeNote(
            text,
            settings.clozePatterns,
            settings.latexClozes === true,
            style,
        );
        if (made.note === null) return [];
        const { note, formatter, render } = made;
        return Array.from({ length: note.numCards }, (_unused, index) => {
            const front = render(note.getCardFront(index, formatter));
            const back = render(note.getCardBack(index, formatter));
            return new CardFrontBack(front, back);
        });
    }
}

const ACCENT = "color:#2196f3";
const MUTED = "color:var(--code-comment)";
const hintText = (hint?: string): string => `[${hint ?? "..."}]`;

export class QuestionTypeClozeFormatter implements IClozeFormatter {
    asking(_answer?: string, hint?: string): string {
        return `<span style='${ACCENT}'>${hintText(hint)}</span>`;
    }
    showingAnswer(answer: string, _hint?: string): string {
        return `<span style='${ACCENT}'>${answer}</span>`;
    }
    hiding(_answer?: string, hint?: string): string {
        return `<span style='${MUTED}'>${hintText(hint)}</span>`;
    }
}

export class QuestionTypeClozeInputFormatter implements IClozeFormatter {
    asking(answer?: string, hint?: string): string {
        const width = Math.max(1, answer?.length ?? 0);
        const field = `<input class="cloze-input" type="text" size="${width}" />`;
        return `<span style='${ACCENT}'>${field}${hint ? `[${hint}]` : ""}</span>`;
    }
    showingAnswer(answer: string, _hint?: string): string {
        return `<span class="cloze-answer" style='${ACCENT}'>${answer}</span>`;
    }
    hiding(_answer?: string, hint?: string): string {
        return `<span style='${MUTED}'>${hintText(hint)}</span>`;
    }
}

export class QuestionTypeFactory {
    static create(type: CardType): IQuestionTypeHandler {
        const handlers: Record<CardType, () => IQuestionTypeHandler> = {
            [CardType.SingleLineBasic]: () =>
                new SingleLine((s) => s.singleLineCardSeparator, false),
            [CardType.SingleLineReversed]: () =>
                new SingleLine((s) => s.singleLineReversedCardSeparator, true),
            [CardType.MultiLineBasic]: () => new Multiline((s) => s.multilineCardSeparator, false),
            [CardType.MultiLineReversed]: () =>
                new Multiline((s) => s.multilineReversedCardSeparator, true),
            [CardType.Cloze]: () => new Cloze(),
            [CardType.Callout]: () => new Callout(),
            [CardType.ImageOcclusion]: () => new ImageOcclusion(),
        };
        return handlers[type]();
    }
}

export class CardFrontBackUtil {
    static expand(
        questionType: CardType,
        questionText: string,
        settings: StudioSettings,
    ): CardFrontBack[] {
        const handler = QuestionTypeFactory.create(questionType);
        return handler.expand(questionText, settings);
    }
}
