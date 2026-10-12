import { CardMeta, cloneCardMeta, emptyCardMeta } from "src/data/card-meta";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";

import { Card, DataStoreAlgorithm, Question } from "./api";
import { golden, scheduleFor, settingsWith, setUp } from "./helpers";

interface Row {
    algorithm: SchedulerKind;
    state: string;
    segment: string;
    idAfter: string | null;
}

const states: Record<string, () => { sm2?: boolean; fsrs?: boolean; meta: Partial<CardMeta> }> = {
    "new, no meta": () => ({ meta: {} }),
    "scheduled sm2": () => ({ sm2: true, meta: {} }),
    "scheduled fsrs": () => ({ fsrs: true, meta: {} }),
    "scheduled with existing id": () => ({ sm2: true, meta: { id: "keep01" } }),
    "new but suspended": () => ({ meta: { suspended: true } }),
    "new, bare id only": () => ({ meta: { id: "bare01" } }),
    "new, extras only": () => ({ meta: { extras: ["x=1"] } }),
    "scheduled, all meta": () => ({
        sm2: true,
        meta: {
            id: "i1",
            suspended: true,
            buryUntil: "2026-11-01",
            flag: 5,
            leech: true,
            extras: ["q=1", "r"],
        },
    }),
};

const rows = golden<Row[]>("format-comment");

// The ids come from one counter that runs on through the rows of an algorithm
describe.each([SchedulerKind.SM2, SchedulerKind.FSRS])("segments under %s", (algorithm) => {
    test("the segment written for one card in each state, and the id it holds afterwards", () => {
        const settings = settingsWith({ algorithm });
        setUp(settings);
        for (const row of rows.filter((r) => r.algorithm === algorithm)) {
            const spec = states[row.state]();
            const card = new Card({});
            card.meta = { ...cloneCardMeta(emptyCardMeta()), ...spec.meta };
            if (spec.sm2) card.scheduleInfo = scheduleFor({ set: "sm2" });
            if (spec.fsrs) card.scheduleInfo = scheduleFor({ set: "fsrs" });
            const question = new Question({ cards: [card] });

            const comment =
                DataStoreAlgorithm.getInstance().questionFormatScheduleAsHtmlComment(question);

            expect([row.state, comment, card.meta.id]).toEqual([
                row.state,
                `<!--SR:${row.segment}-->`,
                row.idAfter,
            ]);
        }
    });
});
