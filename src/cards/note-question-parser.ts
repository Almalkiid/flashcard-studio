import { CardFrontBackUtil } from "src/cards/expand";
import { parse, ParsedQuestionInfo, parserOptionsFromSettings } from "src/cards/parse";
import { CardMeta, emptyCardMeta, parseCommentMeta } from "src/data/card-meta";
import { DataStore } from "src/data/data-store/store";
import { Card } from "src/data/data-structures/card/flashcard";
import { CardType, Question } from "src/data/data-structures/card/question";
import { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import { TopicPath, TopicPathList } from "src/data/decks/topic-path";
import { SettingsUtil, StudioSettings } from "src/data/settings-model";
import { legacyClozeCardIndices } from "src/math/math-cloze";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { splitNoteIntoFrontmatterAndContent, TextDirection } from "src/utils/text";

interface PositionedTag {
    tag: string;
    position: { start: { line: number } };
}

/** Turns one cached note into questions and cards without modifying note text. */
export class NoteQuestionParser {
    constructor(public readonly settings: StudioSettings) {}

    async createQuestionList(
        noteFile: IVaultNoteFile,
        defaultTextDirection: TextDirection,
        folderTopicPath: TopicPath,
        onlyKeepQuestionsWithTopicPath: boolean,
    ): Promise<Question[]> {
        const cachedTags = noteFile.getAllTagsFromCache();
        if (
            !folderTopicPath.hasPath &&
            !cachedTags.some((tag) => SettingsUtil.isFlashcardTag(this.settings, tag))
        )
            return [];

        const noteText = await noteFile.cachedRead();
        const [, contentText] = splitNoteIntoFrontmatterAndContent(noteText);
        const textDirection =
            noteFile.getTextDirection() === TextDirection.Unspecified
                ? defaultTextDirection
                : noteFile.getTextDirection();
        const parsed = parse(contentText, parserOptionsFromSettings(this.settings));
        const allTags = noteFile.getAllTagsFromText() as PositionedTag[];
        const questionTags = this.topicLists(allTags, parsed);
        const legacyTag = allTags.find((entry) =>
            SettingsUtil.isFlashcardTag(this.settings, entry.tag),
        );
        const fallback = legacyTag
            ? new TopicPathList(
                  [TopicPath.getTopicPathFromTag(legacyTag.tag)],
                  legacyTag.position.start.line,
              )
            : null;
        const questions: Question[] = [];

        for (const info of parsed) {
            const topicList = this.settings.convertFoldersToDecks
                ? new TopicPathList([folderTopicPath])
                : this.topicFor(info, questionTags, fallback);
            const question = Question.Create(
                this.settings,
                info,
                topicList,
                textDirection,
                noteFile.getQuestionContext(info.firstLineNum),
            );
            if (question.questionText.topicPathWithWs && question.topicPathList) {
                question.topicPathList.lineNum = info.firstLineNum;
            }
            if (onlyKeepQuestionsWithTopicPath && !question.topicPathList?.length) continue;
            this.populateCards(question);
            questions.push(question);
        }
        return questions;
    }

    private topicLists(tags: PositionedTag[], parsed: ParsedQuestionInfo[]): TopicPathList[] {
        const accepted = tags
            .filter(
                (entry) =>
                    SettingsUtil.isFlashcardTag(this.settings, entry.tag) &&
                    !parsed.some((question) =>
                        question.isQuestionLineNum(entry.position.start.line),
                    ),
            )
            .sort((left, right) => left.position.start.line - right.position.start.line);
        const result: TopicPathList[] = [];
        for (const entry of accepted) {
            const previous = result[result.length - 1];
            if (previous?.lineNum === entry.position.start.line) {
                previous.list.push(TopicPath.getTopicPathFromTag(entry.tag));
            } else {
                result.push(
                    new TopicPathList(
                        [TopicPath.getTopicPathFromTag(entry.tag)],
                        entry.position.start.line,
                    ),
                );
            }
        }
        return result;
    }

    private topicFor(
        question: ParsedQuestionInfo,
        topicLists: TopicPathList[],
        fallback: TopicPathList,
    ): TopicPathList {
        let selected: TopicPathList | null = null;
        for (const list of topicLists) {
            if (list.lineNum < question.firstLineNum) selected = list;
            else break;
        }
        return selected ?? fallback;
    }

    private populateCards(question: Question): void {
        const frontsAndBacks = CardFrontBackUtil.expand(
            question.questionType,
            question.questionText.actualQuestion,
            this.settings,
        );
        let schedules: ScheduleState[] = DataStore.getInstance().createSchedule(
            question.questionText.original,
        );
        let meta: CardMeta[] = parseCommentMeta(question.questionText.original);

        if (
            question.questionType === CardType.Cloze &&
            this.settings.latexClozes === true &&
            schedules.length > frontsAndBacks.length
        ) {
            const legacy = legacyClozeCardIndices(
                question.questionText.actualQuestion,
                this.settings.clozePatterns,
            );
            if (legacy !== null) {
                schedules = legacy.map((index) => schedules[index]);
                meta = legacy.map((index) => meta[index] ?? emptyCardMeta());
                question.hasChanged = true;
            }
        }
        // Surplus segments are left out of the cards but stay in the note: reading a note never rewrites it for them
        if (schedules.length > frontsAndBacks.length) {
            schedules = schedules.slice(0, frontsAndBacks.length);
            meta = meta.slice(0, frontsAndBacks.length);
        }

        const cards = frontsAndBacks.map(
            (side, index) =>
                new Card({
                    front: side.front,
                    back: side.back,
                    cardIdx: index,
                    scheduleInfo: schedules[index] ?? null,
                    meta: meta[index] ?? emptyCardMeta(),
                }),
        );
        question.setCardList(cards);
    }
}
