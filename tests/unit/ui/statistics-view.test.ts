import { ChartHost } from "src/ui/statistics-view/charts";
import { StatisticsView } from "src/ui/statistics-view/statistics-view";
import { loadStatsInputs, StatsInputs } from "src/ui/statistics-view/stats-data";

// Loading the inputs reads the vault and the review log; here it ends when the test says so
jest.mock("src/ui/statistics-view/stats-data", () => ({ loadStatsInputs: jest.fn() }));
// Every chart the view draws is made through its chart host, so a new host means the view drew
jest.mock("src/ui/statistics-view/charts", () => ({
    ChartHost: jest.fn().mockImplementation(() => ({ destroyAll: jest.fn() })),
}));
jest.mock("src/ui/statistics-view/chart-theme", () => ({ readChartTheme: () => ({}) }));
jest.mock("src/stats/report", () => ({ buildStatsReport: () => ({ hasHistory: false }) }));
jest.mock("src/ui/statistics-view/heatmap", () => ({ renderHeatmap: jest.fn() }));
jest.mock("src/ui/statistics-view/sections-activity", () => ({
    renderDaily: jest.fn(),
    renderHourly: jest.fn(),
    renderMetrics: jest.fn(),
}));
jest.mock("src/ui/statistics-view/sections-cards", () => ({
    renderCardCounts: jest.fn(),
    renderDifficulty: jest.fn(),
    renderForecast: jest.fn(),
    renderIntervals: jest.fn(),
    renderRetrievability: jest.fn(),
    renderStability: jest.fn(),
}));
jest.mock("src/ui/statistics-view/sections-insights", () => ({ renderWeakAreas: jest.fn() }));
jest.mock("src/ui/statistics-view/sections-progress", () => ({ renderProgress: jest.fn() }));
jest.mock("src/ui/statistics-view/sections-tables", () => ({
    renderAnswerButtons: jest.fn(),
    renderEmptyState: jest.fn(),
    renderTrueRetention: jest.fn(),
}));

// The helpers Obsidian adds to every element, as far as the view's frame uses them
function make(parent: HTMLElement, tag: string, options: DomElementInfo = {}): HTMLElement {
    const el = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    if (typeof options.cls === "string") el.className = options.cls;
    if (typeof options.text === "string") el.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) {
        el.setAttribute(name, String(value));
    }
    parent.appendChild(el);
    return el;
}

beforeAll(() => {
    Object.assign(HTMLElement.prototype, {
        createEl(this: HTMLElement, tag: string, options?: DomElementInfo) {
            return make(this, tag, options);
        },
        createDiv(this: HTMLElement, options?: DomElementInfo) {
            return make(this, "div", options);
        },
        createSpan(this: HTMLElement, options?: DomElementInfo) {
            return make(this, "span", options);
        },
        empty(this: HTMLElement) {
            this.replaceChildren();
        },
        addClass(this: HTMLElement, ...classes: string[]) {
            this.classList.add(...classes);
        },
        removeClass(this: HTMLElement, ...classes: string[]) {
            this.classList.remove(...classes);
        },
        toggleClass(this: HTMLElement, cls: string, on: boolean) {
            this.classList.toggle(cls, on);
        },
        hasClass(this: HTMLElement, cls: string) {
            return this.classList.contains(cls);
        },
    });
    Object.assign(window, { activeWindow: { matchMedia: () => ({ matches: false }) } });
});

const inputs = {
    entries: [],
    cards: [],
    decks: [],
    dayKeyOf: () => "2023-09-06",
    weekStart: 1,
} as unknown as StatsInputs;

/** A statistics view whose load of the inputs ends when `finishLoading` is called. */
function statisticsView() {
    let finishLoading: (loaded: StatsInputs) => void = () => undefined;
    jest.mocked(loadStatsInputs).mockImplementation(
        () =>
            new Promise((resolve) => {
                finishLoading = resolve;
            }),
    );
    const plugin = {
        isInitialized: true,
        dataManager: { data: { settings: { fsrsDesiredRetention: 0.9 } } },
    };
    const view = new StatisticsView({} as never, plugin as never);
    Object.assign(view, { app: { workspace: { on: () => ({}) } } });
    return { view, finishLoading: () => finishLoading(inputs) };
}

beforeEach(() => jest.mocked(ChartHost).mockClear());

describe("the statistics view", () => {
    test("draws once its data is loaded, and destroys its charts when closed", async () => {
        const { view, finishLoading } = statisticsView();
        const opened = view.onOpen();
        finishLoading();
        await opened;
        expect(ChartHost).toHaveBeenCalledTimes(1);

        await view.onClose();
        const host = jest.mocked(ChartHost).mock.results[0].value as { destroyAll: jest.Mock };
        expect(host.destroyAll).toHaveBeenCalledTimes(1);
    });

    // Charts drawn into the closed view were never destroyed: Chart.js kept them, each with an observer on the
    // whole document, and with them the whole review log
    test("closed while it loads, it draws nothing when the load ends", async () => {
        const { view, finishLoading } = statisticsView();
        const opened = view.onOpen();
        await view.onClose();
        finishLoading();
        await opened;

        expect(ChartHost).not.toHaveBeenCalled();
    });
});
