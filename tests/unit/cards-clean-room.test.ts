import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { CardFrontBackUtil } from "src/cards/expand";
import { NoteQuestionParser } from "src/cards/note-question-parser";
import { parse, parserOptionsFromSettings } from "src/cards/parse";
import { NotesDataStore } from "src/data/data-store/notes/notes-store";
import { DataStore } from "src/data/data-store/store";
import { CardType, QuestionText } from "src/data/data-structures/card/question";
import { TopicPath } from "src/data/decks/topic-path";
import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import { TextDirection } from "src/utils/text";

interface ExpectedSide {
    front: string;
    back: string;
}

interface ExpectedCard {
    type: keyof typeof CardType;
    firstLine: number;
    lastLine: number;
    text: string;
    actualQuestion: string;
    sides: ExpectedSide[];
}

interface ParseExpandCase {
    id: string;
    options: Partial<StudioSettings>;
    input: string;
    cards: ExpectedCard[];
}

interface NoteParseCase {
    id: string;
    options: Partial<StudioSettings>;
    folderTopicPath: string[];
    path: string;
    input: string;
    questions: Array<{
        type: keyof typeof CardType;
        firstLine: number;
        lastLine: number;
        original: string;
        actualQuestion: string;
        blockId: string | null;
        questionTopic: { pre: string; tag: string; post: string } | null;
        topics: string;
        textHash: string;
        hasChanged: boolean;
        cards: Array<{
            idx: number;
            front: string;
            back: string;
            schedule: string | null;
            meta: unknown;
        }>;
    }>;
}

interface QuestionTextCase {
    id: string;
    options: Partial<StudioSettings>;
    original: string;
    actualQuestion: string;
    blockId: string | null;
    topic: { pre: string; tag: string; post: string } | null;
    formatTopicAndQuestion: string;
    textHash: string;
    endsWithCodeBlock: boolean;
}

function loadGolden<T>(name: string): T {
    const parsed: unknown = JSON.parse(
        readFileSync(join(__dirname, "parser", "golden", name), "utf8"),
    );
    return parsed as T;
}

const parseExpandCases = loadGolden<ParseExpandCase[]>("parse-expand.json");
const noteParseCases = loadGolden<NoteParseCase[]>("note-parse.json");
const questionTextCases = loadGolden<QuestionTextCase[]>("question-text.json");

function settingsFor(options: Partial<StudioSettings>): StudioSettings {
    return { ...cloneDefaultSettings(), ...options };
}

function formatTopics(question: { topicPathList: { format(separator: string): string } }): string {
    try {
        return question.topicPathList.format("|");
    } catch (error) {
        return `throws: ${(error as Error).message}`;
    }
}

class GoldenNoteFile {
    constructor(
        readonly path: string,
        private readonly text: string,
    ) {}

    getAllTagsFromCache(): string[] {
        return this.tags().map((tag) => tag.tag);
    }

    getAllTagsFromText() {
        return this.tags();
    }

    getTextDirection(): TextDirection {
        const direction = /^direction:\s*(.+)$/m.exec(this.text)?.[1]?.trim().toLowerCase();
        return direction === "rtl"
            ? TextDirection.Rtl
            : direction === "ltr"
              ? TextDirection.Ltr
              : TextDirection.Unspecified;
    }

    async cachedRead(): Promise<string> {
        return this.text;
    }

    getQuestionContext(line: number): string[] {
        const stack: Array<{ level: number; text: string }> = [];
        for (const [index, value] of this.text.split(/\r?\n/).entries()) {
            if (index > line) break;
            const heading = /^(#{1,6})\s+(.+)$/.exec(value);
            if (!heading) continue;
            const level = heading[1].length;
            while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
            stack.push({ level, text: heading[2].replace(/\[\^\d+\]/g, "").trim() });
        }
        return stack.map((heading) => heading.text);
    }

    private tags() {
        const tags: Array<{ tag: string; position: { start: { line: number } } }> = [];
        for (const [line, text] of this.text.split(/\r?\n/).entries()) {
            for (const match of text.matchAll(/(^|\s)(#[^\s#]+)/g)) {
                tags.push({ tag: match[2], position: { start: { line } } });
            }
        }
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(this.text)?.[1] ?? "";
        const list = /(?:^|\n)tags:\s*\n((?:\s*-\s*[^\n]+\n?)*)/.exec(frontmatter)?.[1] ?? "";
        for (const value of list.matchAll(/^\s*-\s*(\S+)\s*$/gm)) {
            tags.push({
                tag: value[1].startsWith("#") ? value[1] : `#${value[1]}`,
                position: { start: { line: -1 } },
            });
        }
        return tags;
    }
}

interface PinnedCard {
    type: keyof typeof CardType;
    firstLine: number;
    lastLine: number;
    text: string;
}

/** Golden rows whose parse output deliberately differs (fixes 6 and 13 of the behaviour inventory section 15). */
const CHANGED_PARSE_ROWS: Record<string, PinnedCard[]> = {
    // item 13
    "sl-sched-callout-nocomment": [
        { type: "SingleLineBasic", firstLine: 0, lastLine: 0, text: "Q::A" },
        { type: "SingleLineBasic", firstLine: 4, lastLine: 4, text: "later::card" },
    ],
    // item 6
    "ml-first-line-reversed": [],
    // item 6
    "ml-first-line-after-blank": [
        { type: "SingleLineBasic", firstLine: 0, lastLine: 0, text: "x::y" },
    ],
};

describe("clean-room cards parser", () => {
    test("matches every parse-expand golden row", () => {
        const changed: string[] = [];
        for (const vector of parseExpandCases) {
            const settings = settingsFor(vector.options);
            const parsed = parse(vector.input, parserOptionsFromSettings(settings));

            const actual = parsed.map((card) => ({
                type: CardType[card.cardType],
                firstLine: card.firstLineNum,
                lastLine: card.lastLineNum,
                text: card.text,
            }));
            const pinned = CHANGED_PARSE_ROWS[vector.id];
            if (pinned) {
                expect(actual, vector.id).toEqual(pinned);
                changed.push(vector.id);
                continue;
            }
            expect(parsed, vector.id).toHaveLength(vector.cards.length);
            expect(actual, vector.id).toEqual(
                vector.cards.map(({ type, firstLine, lastLine, text }) => ({
                    type,
                    firstLine,
                    lastLine,
                    text,
                })),
            );

            for (let index = 0; index < parsed.length; index++) {
                const expected = vector.cards[index];
                expect(
                    CardFrontBackUtil.expand(
                        parsed[index].cardType,
                        expected.actualQuestion,
                        settings,
                    ),
                    `${vector.id} card ${index}`,
                ).toEqual(expected.sides);
            }
        }
        expect(changed.sort()).toEqual(Object.keys(CHANGED_PARSE_ROWS).sort());
    });

    test("parses 2,000 lines with 300 cards", () => {
        const settings = cloneDefaultSettings();
        const text = Array.from({ length: 2000 }, (_value, index) =>
            index < 300 ? `Question ${index}::Answer ${index}` : `prose ${index}`,
        ).join("\n");

        const options = parserOptionsFromSettings(settings);
        for (let run = 0; run < 5; run++) parse(text, options);
        const samples = Array.from({ length: 50 }, () => {
            const started = performance.now();
            const cards = parse(text, options);
            expect(cards).toHaveLength(300);
            return performance.now() - started;
        }).sort((left, right) => left - right);

        if (process.env.PARSER_BENCHMARK === "1") {
            console.info(
                `PARSER_BENCHMARK best_ms=${samples[0].toFixed(3)} median_ms=${samples[25].toFixed(3)}`,
            );
        }
        expect(samples[0]).toBeLessThan(100);
    });

    test("matches every note-parse golden row", async () => {
        for (const vector of noteParseCases) {
            const settings = settingsFor(vector.options);
            DataStore.instance = new NotesDataStore(settings, {} as never);
            const parser = new NoteQuestionParser(settings);
            const questions = await parser.createQuestionList(
                new GoldenNoteFile(vector.path, vector.input) as never,
                TextDirection.Ltr,
                new TopicPath(vector.folderTopicPath),
                true,
            );
            expect(
                questions.map((question) => ({
                    type: CardType[question.questionType],
                    firstLine: question.parsedQuestionInfo.firstLineNum,
                    lastLine: question.parsedQuestionInfo.lastLineNum,
                    original: question.questionText.original,
                    actualQuestion: question.questionText.actualQuestion,
                    blockId: question.questionText.obsidianBlockId || null,
                    questionTopic: question.questionText.topicPathWithWs
                        ? {
                              preWs: question.questionText.topicPathWithWs.preWhitespace,
                              tag: question.questionText.topicPathWithWs.topicPath.formatAsTag(),
                              postWs: question.questionText.topicPathWithWs.postWhitespace,
                          }
                        : null,
                    topics: formatTopics(question),
                    textHash: question.questionText.textHash,
                    hasChanged: question.hasChanged,
                    cards: question.cards.map((card) => ({
                        idx: card.cardIdx,
                        front: card.front,
                        back: card.back,
                        schedule: card.scheduleInfo?.formatScheduleAsComment() ?? null,
                        meta: card.meta,
                    })),
                })),
                vector.id,
            ).toEqual(vector.questions);
        }
    });

    test("matches every question-text golden row", () => {
        for (const vector of questionTextCases) {
            const settings = settingsFor(vector.options);
            DataStore.instance = new NotesDataStore(settings, {} as never);
            const actual = QuestionText.create(vector.original, TextDirection.Ltr, settings);
            expect(
                {
                    actualQuestion: actual.actualQuestion,
                    blockId: actual.obsidianBlockId || null,
                    topic: actual.topicPathWithWs
                        ? {
                              pre: actual.topicPathWithWs.preWhitespace,
                              tag: actual.topicPathWithWs.topicPath.formatAsTag(),
                              post: actual.topicPathWithWs.postWhitespace,
                          }
                        : null,
                    formatTopicAndQuestion: actual.formatTopicAndQuestion(),
                    textHash: actual.textHash,
                    endsWithCodeBlock: actual.endsWithCodeBlock(),
                },
                vector.id,
            ).toEqual({
                actualQuestion: vector.actualQuestion,
                blockId: vector.blockId,
                topic: vector.topic,
                formatTopicAndQuestion: vector.formatTopicAndQuestion,
                textHash: vector.textHash,
                endsWithCodeBlock: vector.endsWithCodeBlock,
            });
        }
    });
});
