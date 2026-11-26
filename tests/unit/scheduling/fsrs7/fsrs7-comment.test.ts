import { formatMetaTokens, parseSegmentMeta } from "src/data/card-meta";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { CommentParser } from "src/utils/schedule-comment";

const FSRS6 = "!fsrs,2026-12-06T12:00:00.000Z,10,9.5,5.1,2,4,0,0,2026-11-26T12:00:00.000Z";
// Field 3 is S90 (12.25); the token holds the two traces, then the S90, difficulty, reps and last review it belongs to
const FSRS7 =
    "!fsrs,2026-12-08T12:00:00.000Z,12,12.25,5.1,2,4,0,0,2026-11-26T12:00:00.000Z,f7=10.5:40.25:12.25:5.1:4:1795694400000";

const parse = (text: string) => CommentParser.parseMultiScheduleComment(text)[0] as FsrsState;

describe("FSRS-7 in the schedule comment (issue #27)", () => {
    test("an FSRS-6 segment reads as before, with no FSRS-7 memory, and writes back unchanged", () => {
        const state = parse(FSRS6);
        expect(state.fsrs7).toBeNull();
        expect(state.formatScheduleAsComment()).toBe(FSRS6);
    });

    test("an FSRS-7 segment keeps S90 in field 3 and the two traces in its token, and writes back unchanged", () => {
        const state = parse(FSRS7);
        expect([state.stability, state.difficulty]).toEqual([12.25, 5.1]);
        expect(state.fsrs7).toEqual({ stability: 10.5, stabilityFast: 40.25 });
        expect(state.formatScheduleAsComment()).toBe(FSRS7);
    });

    test("a token whose S90 is not field 3 (the card was answered by an older version) is ignored", () => {
        const stale = FSRS7.replace(",12.25,5.1,", ",13.5,5.4,");
        expect(parse(stale).fsrs7).toBeNull();
        expect(parse(stale).stability).toBe(13.5);
    });

    test.each([
        "f7=x:1:12.25:5.1:4:1795694400000",
        "f7=10.5:40.25:12.25",
        "f7=-1:40.25:12.25:5.1:4:1795694400000",
        "f7=10.5:0:12.25:5.1:4:1795694400000",
        "f7=10.5:40.25:12.25:5.1:5:1795694400000",
        "f7=10.5:40.25:12.25:5.1:4:1795694460000",
    ])("an unreadable token (%s) is ignored", (token) => {
        expect(parse(FSRS7.replace(/f7=.*$/, token)).fsrs7).toBeNull();
    });

    test("the f7 token belongs to the schedule: metadata never keeps or repeats it", () => {
        const meta = parseSegmentMeta(`${FSRS7.slice(1)},id=k3f9a2,susp,custom`);
        expect([meta.id, meta.suspended, meta.extras]).toEqual(["k3f9a2", true, ["custom"]]);
        expect(formatMetaTokens(meta)).toBe(",id=k3f9a2,susp,custom");
    });

    test("an older version's rewrite (stale token kept as an extra) loses the token on the next write", () => {
        const stale = FSRS7.replace(",12.25,5.1,", ",13.5,5.4,") + ",id=k3f9a2";
        const state = parse(stale);
        const meta = parseSegmentMeta(stale.slice(1));
        expect(state.formatScheduleAsComment() + formatMetaTokens(meta)).toBe(
            "!fsrs,2026-12-08T12:00:00.000Z,12,13.5,5.4,2,4,0,0,2026-11-26T12:00:00.000Z,id=k3f9a2",
        );
    });
});
