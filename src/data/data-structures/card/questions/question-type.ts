import { ClozeCrafter, IClozeFormatter } from "clozecraft";

import { splitCalloutCard } from "src/data/data-structures/card/questions/callout-card";
import {
    containsMathCloze,
    expandMathClozes,
    replaceMathClozesWithAnswers,
} from "src/data/data-structures/card/questions/math-cloze";
import { CardType } from "src/data/data-structures/card/questions/question";
import { SRSettings } from "src/data/settings";
import { findLineIndexOfSearchStringIgnoringWs } from "src/utils/strings";

export class CardFrontBack {
    front: string;
    back: string;

    // The caller is responsible for any required trimming of leading/trailing spaces
    constructor(front: string, back: string) {
        this.front = front;
        this.back = back;
    }
}

export class CardFrontBackUtil {
    static expand(
        questionType: CardType,
        questionText: string,
        settings: SRSettings,
    ): CardFrontBack[] {
        const handler: IQuestionTypeHandler = QuestionTypeFactory.create(questionType);
        return handler.expand(questionText, settings);
    }
}

export interface IQuestionTypeHandler {
    expand(questionText: string, settings: SRSettings): CardFrontBack[];
}

class QuestionTypeSingleLineBasic implements IQuestionTypeHandler {
    expand(questionText: string, settings: SRSettings): CardFrontBack[] {
        const idx: number = questionText.indexOf(settings.singleLineCardSeparator);
        const item: CardFrontBack = new CardFrontBack(
            questionText.substring(0, idx),
            questionText.substring(idx + settings.singleLineCardSeparator.length),
        );
        const result: CardFrontBack[] = [item];
        return result;
    }
}

class QuestionTypeSingleLineReversed implements IQuestionTypeHandler {
    expand(questionText: string, settings: SRSettings): CardFrontBack[] {
        const idx: number = questionText.indexOf(settings.singleLineReversedCardSeparator);
        const side1: string = questionText.substring(0, idx),
            side2: string = questionText.substring(
                idx + settings.singleLineReversedCardSeparator.length,
            );
        const result: CardFrontBack[] = [
            new CardFrontBack(side1, side2),
            new CardFrontBack(side2, side1),
        ];
        return result;
    }
}

class QuestionTypeMultiLineBasic implements IQuestionTypeHandler {
    expand(questionText: string, settings: SRSettings): CardFrontBack[] {
        // We don't need to worry about "\r\n", as multi line questions processed by parse() concatenates lines explicitly with "\n"
        const questionLines = questionText.split("\n");
        const lineIdx = findLineIndexOfSearchStringIgnoringWs(
            questionLines,
            settings.multilineCardSeparator,
        );
        const side1: string = questionLines.slice(0, lineIdx).join("\n");
        const side2: string = questionLines.slice(lineIdx + 1).join("\n");

        const result: CardFrontBack[] = [new CardFrontBack(side1, side2)];
        return result;
    }
}

class QuestionTypeMultiLineReversed implements IQuestionTypeHandler {
    expand(questionText: string, settings: SRSettings): CardFrontBack[] {
        // We don't need to worry about "\r\n", as multi line questions processed by parse() concatenates lines explicitly with "\n"
        const questionLines = questionText.split("\n");
        const lineIdx = findLineIndexOfSearchStringIgnoringWs(
            questionLines,
            settings.multilineReversedCardSeparator,
        );
        const side1: string = questionLines.slice(0, lineIdx).join("\n");
        const side2: string = questionLines.slice(lineIdx + 1).join("\n");

        const result: CardFrontBack[] = [
            new CardFrontBack(side1, side2),
            new CardFrontBack(side2, side1),
        ];
        return result;
    }
}

// The title of a callout is the front and its body the back
class QuestionTypeCallout implements IQuestionTypeHandler {
    expand(questionText: string, _settings: SRSettings): CardFrontBack[] {
        const card = splitCalloutCard(questionText);
        return card === null ? [] : [new CardFrontBack(card.front, card.back)];
    }
}

// Shows every cloze as its plain answer
const plainAnswerFormatter: IClozeFormatter = {
    asking: (answer?: string) => answer ?? "",
    showingAnswer: (answer: string) => answer,
    hiding: (answer?: string) => answer ?? "",
};

class QuestionTypeCloze implements IQuestionTypeHandler {
    expand(questionText: string, settings: SRSettings): CardFrontBack[] {
        const clozecrafter = new ClozeCrafter(settings.clozePatterns);

        // M3b: `\cloze{answer}{hint}` macros make cards of their own, after the cards of the other clozes.
        // In the other clozes' cards a macro shows its answer, and in the macros' cards the other clozes do.
        const hasMathClozes = settings.latexClozes === true && containsMathCloze(questionText);
        const clozeNote = clozecrafter.createClozeNote(
            hasMathClozes ? replaceMathClozesWithAnswers(questionText) : questionText,
        );

        // Determine which question formatter to use based on settings (Cloze patterns as inputs or not).
        // Typing answers fills in the blanks in the card as well.
        const clozeFormatter =
            settings.convertClozePatternsToInputs || settings.typeAnswers
                ? new QuestionTypeClozeInputFormatter()
                : new QuestionTypeClozeFormatter();

        let front: string, back: string;
        const result: CardFrontBack[] = [];

        if (clozeNote !== null) {
            for (let i = 0; i < clozeNote.numCards; i++) {
                front = clozeNote.getCardFront(i, clozeFormatter);
                back = clozeNote.getCardBack(i, clozeFormatter);
                result.push(new CardFrontBack(front, back));
            }
        }

        if (hasMathClozes) {
            const plainText = clozecrafter
                .createClozeNote(questionText)
                ?.getCardBack(0, plainAnswerFormatter);
            for (const card of expandMathClozes(plainText ?? questionText, clozeFormatter)) {
                result.push(new CardFrontBack(card.front, card.back));
            }
        }

        return result;
    }
}

export class QuestionTypeClozeFormatter implements IClozeFormatter {
    asking(_?: string, hint?: string): string {
        return `<span style='color:#2196f3'>${!hint ? "[...]" : `[${hint}]`}</span>`;
    }

    showingAnswer(answer: string, _?: string): string {
        return `<span style='color:#2196f3'>${answer}</span>`;
    }

    hiding(_?: string, hint?: string): string {
        return `<span style='color:var(--code-comment)'>${!hint ? "[...]" : `[${hint}]`}</span>`;
    }
}

export class QuestionTypeClozeInputFormatter implements IClozeFormatter {
    asking(answer?: string, hint?: string): string {
        return `<span style='color:#2196f3'><input class="cloze-input" type="text" size="${!answer ? 1 : answer.length}" />${!hint ? "" : `[${hint}]`}</span>`;
    }

    showingAnswer(answer: string, _?: string): string {
        return `<span class="cloze-answer" style='color:#2196f3'>${answer}</span>`;
    }

    hiding(_?: string, hint?: string): string {
        return `<span style='color:var(--code-comment)'>${!hint ? "[...]" : `[${hint}]`}</span>`;
    }
}

export class QuestionTypeFactory {
    static create(questionType: CardType): IQuestionTypeHandler {
        let handler: IQuestionTypeHandler;
        switch (questionType) {
            case CardType.SingleLineBasic:
                handler = new QuestionTypeSingleLineBasic();
                break;
            case CardType.SingleLineReversed:
                handler = new QuestionTypeSingleLineReversed();
                break;
            case CardType.MultiLineBasic:
                handler = new QuestionTypeMultiLineBasic();
                break;
            case CardType.MultiLineReversed:
                handler = new QuestionTypeMultiLineReversed();
                break;
            case CardType.Cloze:
                handler = new QuestionTypeCloze();
                break;
            case CardType.Callout:
                handler = new QuestionTypeCallout();
                break;
        }
        return handler;
    }
}
