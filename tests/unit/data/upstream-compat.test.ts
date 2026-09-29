import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { setupStaticDateProvider20230906 } from "src/utils/dates";

import { UpstreamCommentParser } from "./upstream/upstream-comment-parser";

// Flashcard Studio appends metadata tokens (id, suspended, buried, flag, leech) after the fixed fields of each
// schedule segment. The original Spaced Repetition plugin must keep reading the same schedules from these
// comments, so a user can switch back without losing progress.

const TOKEN_PATTERN = /,(id=[0-9a-z]+|susp|leech|flag=[1-7]|bury=\d{4}-\d{2}-\d{2})/g;

function summarize(schedules: (RepItemScheduleInfo | null)[]): (string | null)[] {
    return schedules.map((schedule) =>
        schedule === null
            ? null
            : `${schedule.dueDate.toISOString()}|${schedule.interval}|${schedule.latestEase}`,
    );
}

const COMMENTS_WRITTEN_BY_FLASHCARD_STUDIO = [
    "!fsrs,2026-10-06T08:00:00.000Z,7,7.21,5.1,2,3,0,0,2026-09-29T08:00:00.000Z,id=k3f9a2,flag=1",
    "!fsrs,-,0,0,0,0,0,0,0,-,id=aaaaaa,susp!fsrs,2026-10-06T08:00:00.000Z,7,7.2,5.1,2,3,0,0,-,id=bbbbbb",
    "!2026-10-06,7,250,id=abc123,bury=2026-10-01",
    "!2000-01-01,1,250,id=zzzzzz,susp,leech!2026-10-06,3,270,id=yyyyyy",
];

describe("upstream compatibility", () => {
    beforeEach(() => {
        setupStaticDateProvider20230906();
    });

    test.each(COMMENTS_WRITTEN_BY_FLASHCARD_STUDIO)(
        "upstream parses %s exactly as if the tokens were absent",
        (comment: string) => {
            const withTokens = UpstreamCommentParser.parseMultiScheduleComment(comment);
            const withoutTokens = UpstreamCommentParser.parseMultiScheduleComment(
                comment.replace(TOKEN_PATTERN, ""),
            );
            expect(withTokens).toHaveLength(withoutTokens.length);
            expect(summarize(withTokens)).toEqual(summarize(withoutTokens));
        },
    );

    test("placeholders with metadata still read as new cards upstream", () => {
        const schedules = UpstreamCommentParser.parseMultiScheduleComment(
            "!fsrs,-,0,0,0,0,0,0,0,-,id=aaaaaa,susp!2000-01-01,1,250,id=bbbbbb,susp",
        );
        expect(schedules).toEqual([null, null]);
    });
});
