import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { postponeDueReviews } from "src/ui/scheduling-commands";
import { setupStaticDateProvider20230906 } from "src/utils/clock";

import { FakePlugin } from "./../data/rebuild/fake-plugin";

jest.mock("obsidian", () => ({
    ...jest.requireActual<Record<string, unknown>>("../support/obsidian"),
    getAllTags: (cache: { tags?: { tag: string }[] }) => [
        ...new Set((cache.tags ?? []).map((entry) => entry.tag)),
    ],
}));

beforeEach(() => setupStaticDateProvider20230906());

// SM-2 comments: a card is due on its date
const overdue = (n: number) => `!2023-09-0${n},4,270`;

async function postponeIn(text: string, days = 3): Promise<{ moved: number; text: string }> {
    const fake = new FakePlugin({ "n.md": text }, { algorithm: SchedulerKind.SM2 });
    const { manager } = await fake.startManager();
    const moved = await postponeDueReviews({ dataManager: manager } as never, days);
    return { moved, text: fake.fake.texts.get("n.md") ?? "" };
}

test("only the cards that were counted move: a stray schedule comment in the note's text stays", async () => {
    const stray = `\`\`\`\n<!--SR:${overdue(1)}-->\n\`\`\``;
    const { moved, text } = await postponeIn(
        `#flashcards\nQ::A\n<!--SR:${overdue(2)}-->\n\n${stray}\n`,
    );
    expect(moved).toBe(1);
    expect(text).toContain(stray);
    expect(text).toContain("<!--SR:!2023-09-09,4,270");
    expect(text).not.toContain(overdue(2));
});

test("a card of a question that is not due stays while its sibling moves", async () => {
    const { moved, text } = await postponeIn(
        `#flashcards\nThe ==one== and ==two== <!--SR:${overdue(2)}!2023-12-01,4,270-->\n`,
    );
    expect(moved).toBe(1);
    expect(text).toContain("!2023-09-09,4,270!2023-12-01,4,270");
});
