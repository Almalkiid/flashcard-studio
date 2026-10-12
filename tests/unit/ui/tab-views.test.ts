import { STUDIO_TAB_VIEW } from "src/data/formats";
import { TabViews } from "src/ui/tab-views";

jest.mock("src/ui/studio-tab-view", () => ({
    StudioTabView: class {
        startSession = jest.fn().mockResolvedValue(undefined);
        constructor(
            public leaf: unknown,
            public plugin: unknown,
            public loader: unknown,
        ) {}
    },
}));
jest.mock("src/exam/exam-view", () => ({
    EXAM_VIEW_TYPE: "flashcard-studio-exam",
    ExamView: class {},
}));
jest.mock("src/ui/statistics-view/statistics-view", () => ({
    STATISTICS_VIEW_TYPE: "flashcard-studio-statistics",
    StatisticsView: class {},
}));

import { StudioTabView } from "src/ui/studio-tab-view";

interface FakeLeaf {
    view: unknown;
    setViewState: jest.Mock;
}

function setUp(existing: FakeLeaf[]) {
    const created: FakeLeaf = { view: null, setViewState: jest.fn().mockResolvedValue(undefined) };
    const creators = new Map<string, (leaf: unknown) => unknown>();
    const workspace = {
        getLeavesOfType: jest.fn((type: string) => (type === STUDIO_TAB_VIEW ? existing : [])),
        getLeaf: jest.fn(() => created),
        revealLeaf: jest.fn().mockResolvedValue(undefined),
        detachLeavesOfType: jest.fn(),
    };
    const plugin = {
        app: { workspace },
        registerView: jest.fn((type: string, creator: (leaf: unknown) => unknown) => {
            creators.set(type, creator);
        }),
    };
    const views = new TabViews(plugin as never);
    views.register();
    return { views, workspace, creators, created };
}

const loader = (name: string) => ({ name }) as never;

describe("TabViews.openStudio", () => {
    // The bug: with the Studio tab already open, a new session (cram, review in a note, custom study, the cards
    // missed in an exam) only revealed the tab and so showed the old session.
    test("gives an open Studio tab the new session", async () => {
        const view = new (StudioTabView as never as new () => { startSession: jest.Mock })();
        const leaf: FakeLeaf = { view, setViewState: jest.fn() };
        const { views, workspace } = setUp([leaf]);

        await views.openStudio(loader("cram"));

        expect(view.startSession).toHaveBeenCalledTimes(1);
        expect(view.startSession).toHaveBeenCalledWith(loader("cram"));
        expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
        expect(workspace.getLeaf).not.toHaveBeenCalled();
    });

    test("the tab is brought to the front before it takes the session", async () => {
        const view = new (StudioTabView as never as new () => { startSession: jest.Mock })();
        const { views, workspace } = setUp([{ view, setViewState: jest.fn() }]);
        const order: string[] = [];
        workspace.revealLeaf.mockImplementation(() => {
            order.push("reveal");
            return Promise.resolve();
        });
        view.startSession.mockImplementation(() => {
            order.push("session");
            return Promise.resolve();
        });

        await views.openStudio(loader("a"));

        expect(order).toEqual(["reveal", "session"]);
    });

    test("opens a new tab, which is made with the session, when there is none", async () => {
        const { views, workspace, creators, created } = setUp([]);
        created.setViewState.mockImplementation(() => {
            // Obsidian makes the view while the state is set
            created.view = creators.get(STUDIO_TAB_VIEW)?.(created);
            return Promise.resolve();
        });

        await views.openStudio(loader("review"));

        expect(workspace.getLeaf).toHaveBeenCalledWith("tab");
        expect(created.setViewState).toHaveBeenCalledWith({ type: STUDIO_TAB_VIEW, active: true });
        expect((created.view as { loader: unknown }).loader).toEqual(loader("review"));
        expect(workspace.revealLeaf).toHaveBeenCalledWith(created);
    });

    test("a tab Obsidian restores later is made without a session", async () => {
        const { views, creators, created } = setUp([]);
        created.setViewState.mockResolvedValue(undefined);
        await views.openStudio(loader("review"));

        const restored = creators.get(STUDIO_TAB_VIEW)?.({}) as { loader: unknown };

        expect(restored.loader).toBeNull();
    });

    test("an open tab that is still a placeholder is revealed, then made with the session", async () => {
        const placeholder: FakeLeaf = { view: {}, setViewState: jest.fn() };
        const { views, workspace, creators } = setUp([placeholder]);
        workspace.revealLeaf.mockImplementation(() => {
            placeholder.view = creators.get(STUDIO_TAB_VIEW)?.(placeholder);
            return Promise.resolve();
        });

        await views.openStudio(loader("custom"));

        expect((placeholder.view as { loader: unknown }).loader).toEqual(loader("custom"));
        expect(workspace.getLeaf).not.toHaveBeenCalled();
    });
});
