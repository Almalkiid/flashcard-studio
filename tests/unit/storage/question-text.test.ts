import { TextDirection } from "src/utils/text";

import { QuestionText } from "./api";
import { golden, settingsWith, setUp } from "./helpers";

interface Row {
    id: string;
    options: Record<string, unknown>;
    original: string;
    actualQuestion: string;
    blockId: string | null;
    topic: { pre: string; tag: string; post: string } | null;
    formatTopicAndQuestion: string;
    textHash: string;
    endsWithCodeBlock: boolean;
}

describe.each(golden<Row[]>("question-text"))("question text: $id", (row) => {
    test("the pieces and the hash", () => {
        const settings = settingsWith(row.options);
        setUp(settings);
        const text = QuestionText.create(row.original, TextDirection.Ltr, settings);
        expect(text.actualQuestion).toBe(row.actualQuestion);
        expect(text.obsidianBlockId || null).toBe(row.blockId);
        expect(
            text.topicPathWithWs
                ? {
                      pre: text.topicPathWithWs.preWhitespace,
                      tag: text.topicPathWithWs.topicPath.formatAsTag(),
                      post: text.topicPathWithWs.postWhitespace,
                  }
                : null,
        ).toEqual(row.topic);
        expect(text.formatTopicAndQuestion()).toBe(row.formatTopicAndQuestion);
        expect(text.textHash).toBe(row.textHash);
        expect(text.endsWithCodeBlock()).toBe(row.endsWithCodeBlock);
    });
});
