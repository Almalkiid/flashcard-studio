import { NoteQuestionParser } from "src/cards/note-question-parser";
import { TopicPath } from "src/data/decks/topic-path";
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { NoteFileLoader } from "src/note-review/note-file-loader";
import { TextDirection } from "src/utils/text";

import { UnitTestNoteFile } from "../support/memory-note";
import { unitTestSetupStandardDataStoreAlgorithm } from "../support/setup";
import { expectParity, loadGolden } from "./helpers/parity";
import { freezeAt } from "./helpers/scenario";

// note-question-parser.json: what NoteQuestionParser makes of 23 notes, and that NoteFileLoader gives the same
// questions. The parser is another builder's part; this holds the note review code that wraps it to the same values.

interface Row {
    id: string;
    text: string;
    settingsOverrides: Partial<StudioSettings>;
    folderTopicPath: string[];
    onlyKeepQuestionsWithTopicPath: boolean;
}

beforeEach(() => {
    // The parser warns for a note that has no topic path: that is one of the 23 notes
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

test("note-question-parser.json", async () => {
    freezeAt("2023-09-06T12:00:00");
    const g = loadGolden("note-question-parser") as { clock: string; cases: Row[] };
    const out: unknown[] = [];
    for (const c of g.cases.filter((row) => row.text !== undefined)) {
        const settings: StudioSettings = { ...DEFAULT_SETTINGS, ...c.settingsOverrides };
        unitTestSetupStandardDataStoreAlgorithm(settings);
        const list = await new NoteQuestionParser(settings).createQuestionList(
            new UnitTestNoteFile(c.text, "n.md"),
            c.id === "direction-from-default" ? TextDirection.Rtl : TextDirection.Ltr,
            new TopicPath(c.folderTopicPath),
            c.onlyKeepQuestionsWithTopicPath,
        );
        out.push({
            id: c.id,
            note: (c as unknown as { note: string }).note,
            text: c.text,
            settingsOverrides: c.settingsOverrides,
            folderTopicPath: c.folderTopicPath,
            onlyKeepQuestionsWithTopicPath: c.onlyKeepQuestionsWithTopicPath,
            questions: list.map((q) => ({
                firstLine: q.lineNo,
                type: q.questionType,
                hasChanged: q.hasChanged,
                topicPathList:
                    q.topicPathList === null
                        ? null
                        : { tags: q.topicPathList.formatPsv(), lineNum: q.topicPathList.lineNum },
                textDirection: (q as unknown as { questionText: { textDirection: number } })
                    .questionText.textDirection,
                cards: q.cards.map((card) => ({
                    idx: card.cardIdx,
                    front: card.front,
                    back: card.back,
                    schedule: card.hasSchedule ? card.scheduleInfo.formatScheduleAsComment() : null,
                })),
            })),
        });
    }
    const settings = { ...DEFAULT_SETTINGS };
    unitTestSetupStandardDataStoreAlgorithm(settings);
    const note = await new NoteFileLoader(settings).load(
        new UnitTestNoteFile("#flashcards/t\nQ1::A1\nQ2::A2\n", "n.md"),
        TextDirection.Ltr,
        TopicPath.emptyPath,
    );
    out.push({
        id: "wrappers-loader-vs-parser",
        loaderQuestions: note.questionList.length,
        parserQuestions: undefined,
        filePath: note.filePath,
        hasChanged: note.hasChanged,
    });
    expectParity("note-question-parser", { clock: g.clock, cases: out }, [
        {
            fix: "dead item removed: NoteParser was a copy of NoteFileLoader.load, with no caller in src",
            paths: /^cases\[23\]\.parserQuestions$/,
            only: (was, now) => was === 2 && now === undefined,
        },
        {
            fix: "final review: surplus schedule segments no longer mark the question changed, so scanning does not rewrite the note",
            paths: /\.hasChanged$/,
            only: (was, now) => was === true && now === false,
        },
    ]);
});
