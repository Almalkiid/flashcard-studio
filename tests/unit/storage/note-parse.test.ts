import { NoteQuestionParser } from "src/cards/note-question-parser";
import { TopicPath } from "src/data/decks/topic-path";
import { TextDirection } from "src/utils/text";

import { UnitTestNoteFile } from "../support/memory-note";
import { CardType } from "./api";
import { golden, settingsWith, setUp } from "./helpers";

// The parser belongs to another part. This reads its golden file only for what the question model and the stored
// comment hand it: the pieces of a question text, its hash, and each card's schedule and metadata.

interface Entry {
    id: string;
    options: Record<string, unknown>;
    folderTopicPath: string[];
    path: string;
    input: string;
    questions: {
        type: string;
        firstLine: number;
        lastLine: number;
        original: string;
        actualQuestion: string;
        blockId: string | null;
        questionTopic: { preWs: string; tag: string; postWs: string } | null;
        textHash: string;
        hasChanged: boolean;
        cards: { idx: number; schedule: string | null; meta: unknown }[];
    }[];
}

const entries = golden<Entry[]>("note-parse");

test("question texts, hashes and card schedules of every note of the golden file", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const problems: string[] = [];
    for (const entry of entries) {
        const settings = settingsWith(entry.options);
        setUp(settings);
        const file = new UnitTestNoteFile(entry.input, entry.path);
        const questions = await new NoteQuestionParser(settings).createQuestionList(
            file,
            TextDirection.Ltr,
            new TopicPath(entry.folderTopicPath),
            true,
        );
        const actual = questions.map((q) => ({
            type: CardType[q.questionType],
            firstLine: q.parsedQuestionInfo.firstLineNum,
            lastLine: q.parsedQuestionInfo.lastLineNum,
            original: q.questionText.original,
            actualQuestion: q.questionText.actualQuestion,
            blockId: q.questionText.obsidianBlockId || null,
            questionTopic: q.questionText.topicPathWithWs
                ? {
                      preWs: q.questionText.topicPathWithWs.preWhitespace,
                      tag: q.questionText.topicPathWithWs.topicPath.formatAsTag(),
                      postWs: q.questionText.topicPathWithWs.postWhitespace,
                  }
                : null,
            textHash: q.questionText.textHash,
            hasChanged: q.hasChanged,
            cards: q.cards.map((c) => ({
                idx: c.cardIdx,
                schedule: c.scheduleInfo ? c.scheduleInfo.formatScheduleAsComment() : null,
                meta: c.meta,
            })),
        }));
        const expected = entry.questions.map((q) => ({
            type: q.type,
            firstLine: q.firstLine,
            lastLine: q.lastLine,
            original: q.original,
            actualQuestion: q.actualQuestion,
            blockId: q.blockId,
            questionTopic: q.questionTopic,
            textHash: q.textHash,
            hasChanged: q.hasChanged,
            cards: q.cards.map((c) => ({ idx: c.idx, schedule: c.schedule, meta: c.meta })),
        }));
        if (JSON.stringify(actual) !== JSON.stringify(expected))
            problems.push(
                entry.id +
                    (problems.length < 2
                        ? "\n" + JSON.stringify(actual) + "\n" + JSON.stringify(expected)
                        : ""),
            );
    }
    warn.mockRestore();
    expect(problems).toEqual([]);
});
