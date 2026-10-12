import { cloneDefaultSettings, DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import {
    applyEffects,
    applyReloadedSettings,
    Effect,
    EffectHost,
    effectsFor,
} from "src/settings/effects";

function fakeHost() {
    const calls: string[] = [];
    const host: EffectHost = {
        refreshScheduler: () => calls.push("refreshScheduler"),
        rebuildScheduler: () => calls.push("rebuildScheduler"),
        setMathMacro: (on) => calls.push(`setMathMacro:${on}`),
        restartReminders: () => calls.push("restartReminders"),
        refreshStatusBar: () => calls.push("refreshStatusBar"),
        applyStartOfDay: (text) => calls.push(`applyStartOfDay:${text}`),
        setParserDebug: (on) => calls.push(`setParserDebug:${on}`),
        setHotkeys: (on) => calls.push(`setHotkeys:${on}`),
        leaveTabMode: () => calls.push("leaveTabMode"),
    };
    return { host, calls };
}
const desktop = { isMobile: false };

test.each([
    ["fsrsDesiredRetention", ["refreshScheduler"]],
    ["fsrsWeights", ["refreshScheduler"]],
    ["fsrsLoadBalance", ["refreshScheduler"]],
    ["fsrsEasyDays", ["refreshScheduler"]],
    ["algorithm", ["rebuildScheduler"]],
    ["latexClozes", ["setMathMacro:false"]],
    ["reviewReminderIntervalMinutes", ["restartReminders"]],
    ["showNoteStatusBarItem", ["refreshStatusBar"]],
    ["startOfDay", ["applyStartOfDay:00:00:00"]],
    ["showParserDebugMessages", ["setParserDebug:false"]],
    ["useCustomHotkeys", ["setHotkeys:false"]],
    ["flashcardGoodText", ["setHotkeys:false"]],
    ["newCardsPerDay", []],
] as const)("%s triggers exactly its effect", (key, expected) => {
    const { host, calls } = fakeHost();
    applyEffects([key], cloneDefaultSettings(), host, desktop);
    expect(calls).toEqual(expected);
});

test("each effect runs once even when several of its keys change", () => {
    expect(effectsFor(["fsrsWeights", "fsrsEnableFuzz", "maximumInterval"])).toEqual([
        "refreshScheduler",
    ]);
});

test("changing the provider resets the model and reports it", () => {
    const s = cloneDefaultSettings();
    s.aiProvider = "openai";
    s.aiModel = "claude-x";
    const { host } = fakeHost();
    expect(applyEffects(["aiProvider"], s, host, desktop)).toEqual(["aiModel"]);
    expect(s.aiModel).toBe("");
    s.aiProvider = "anthropic";
    applyEffects(["aiProvider"], s, host, desktop);
    expect(s.aiModel).toBe(DEFAULT_SETTINGS.aiModel);
});

describe("an effect that throws", () => {
    test("does not stop the effects after it, and the keys already changed are still returned", () => {
        const s = cloneDefaultSettings();
        s.aiProvider = "openai";
        s.aiModel = "claude-x";
        const { host, calls } = fakeHost();
        const failure = new Error("bad weights");
        host.refreshScheduler = () => {
            throw failure;
        };
        const onError = jest.fn();

        const changed = applyEffects(
            ["fsrsDesiredRetention", "showNoteStatusBarItem", "aiProvider"],
            s,
            host,
            desktop,
            onError,
        );

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith("refreshScheduler", failure);
        expect(calls).toEqual(["refreshStatusBar"]);
        expect(changed).toEqual(["aiModel"]);
        expect(s.aiModel).toBe("");
    });

    test("a late failure keeps what the early effects changed", () => {
        const s = cloneDefaultSettings();
        s.aiProvider = "openai";
        s.aiModel = "claude-x";
        const { host } = fakeHost();
        host.setHotkeys = () => {
            throw new Error("no commands yet");
        };
        const onError = jest.fn();

        expect(applyEffects(["aiProvider", "useCustomHotkeys"], s, host, desktop, onError)).toEqual(
            ["aiModel"],
        );
        expect(onError).toHaveBeenCalledWith("hotkeys", expect.any(Error));
    });

    test("every failing effect is reported, each with its own name", () => {
        const { host } = fakeHost();
        host.refreshScheduler = () => {
            throw new Error("first");
        };
        host.restartReminders = () => {
            throw new Error("second");
        };
        const onError = jest.fn<void, [Effect, unknown]>();
        applyEffects(
            ["fsrsDesiredRetention", "enableReviewReminders"],
            cloneDefaultSettings(),
            host,
            desktop,
            onError,
        );
        expect(onError.mock.calls.map(([effect]) => effect)).toEqual([
            "refreshScheduler",
            "reminders",
        ]);
    });

    test("without anyone to tell, it is not swallowed", () => {
        const { host } = fakeHost();
        host.refreshScheduler = () => {
            throw new Error("bad weights");
        };
        expect(() =>
            applyEffects(["fsrsDesiredRetention"], cloneDefaultSettings(), host, desktop),
        ).toThrow("bad weights");
    });
});

test("leaving tab mode turns custom hotkeys off and really removes them, and leaves the window size alone", () => {
    const s = cloneDefaultSettings();
    s.openViewInNewTab = false;
    s.desktopLayout = false;
    s.useCustomHotkeys = true;
    s.flashcardHeightPercentage = 60;
    const { host, calls } = fakeHost();
    expect(applyEffects(["openViewInNewTab"], s, host, desktop)).toEqual(["useCustomHotkeys"]);
    expect(s.useCustomHotkeys).toBe(false);
    expect(calls).toEqual(["leaveTabMode", "setHotkeys:false"]);
    expect(s.flashcardHeightPercentage).toBe(60);
});

test("on a computer, the tab key alone off changes nothing while the desktop layout still opens the review in a tab", () => {
    const s = cloneDefaultSettings();
    s.openViewInNewTab = false;
    s.desktopLayout = true;
    s.reviewLook = "studio";
    s.useCustomHotkeys = true;
    const { host, calls } = fakeHost();
    expect(applyEffects(["openViewInNewTab"], s, host, desktop)).toEqual([]);
    expect(s.useCustomHotkeys).toBe(true);
    expect(calls).toEqual([]);
});

test("the phone's tab key does not touch the computer's tab mode", () => {
    const s = cloneDefaultSettings();
    s.openViewInNewTab = true;
    s.openViewInNewTabMobile = true;
    const { host, calls } = fakeHost();
    applyEffects(["openViewInNewTabMobile"], s, host, desktop);
    expect(calls).toEqual([]);
});

test("hotkeys are removed once when leaving tab mode and the hotkeys key changed together", () => {
    const s = cloneDefaultSettings();
    s.openViewInNewTab = false;
    s.desktopLayout = false;
    s.useCustomHotkeys = true;
    const { host, calls } = fakeHost();
    applyEffects(["openViewInNewTab", "useCustomHotkeys"], s, host, desktop);
    expect(calls).toEqual(["leaveTabMode", "setHotkeys:false"]);
});

test("a phone leaving tab mode never turns off the computer's custom hotkeys", () => {
    const s = cloneDefaultSettings();
    s.openViewInNewTab = true;
    s.openViewInNewTabMobile = false;
    s.useCustomHotkeys = true;
    const { host, calls } = fakeHost();
    expect(applyEffects(["openViewInNewTabMobile"], s, host, { isMobile: true })).toEqual([]);
    expect(s.useCustomHotkeys).toBe(true);
    expect(calls).toEqual(["leaveTabMode"]);
});

test("on a phone the phone's tab key decides", () => {
    const s = cloneDefaultSettings();
    s.openViewInNewTab = true;
    s.openViewInNewTabMobile = false;
    const { host, calls } = fakeHost();
    applyEffects(["openViewInNewTabMobile"], s, host, { isMobile: true });
    expect(calls).toEqual(["leaveTabMode"]);
});

describe("the review stops opening in a tab", () => {
    /** Hotkeys on, the device's tab key off, the desktop layout on with the Studio look: the review opens in a tab. */
    function tabbedByTheDesktopLayout() {
        const s = cloneDefaultSettings();
        s.openViewInNewTab = false;
        s.desktopLayout = true;
        s.reviewLook = "studio";
        s.useCustomHotkeys = true;
        return s;
    }

    test("the desktop layout and the look ask for the same effect as the tab keys", () => {
        expect(effectsFor(["desktopLayout"])).toEqual(["openInTab"]);
        expect(effectsFor(["reviewLook"])).toEqual(["openInTab"]);
        expect(effectsFor(["desktopLayout", "reviewLook", "openViewInNewTab"])).toEqual([
            "openInTab",
        ]);
    });

    test("turning the desktop layout off turns custom hotkeys off and really removes them", () => {
        const s = tabbedByTheDesktopLayout();
        s.desktopLayout = false;
        const { host, calls } = fakeHost();
        expect(applyEffects(["desktopLayout"], s, host, desktop)).toEqual(["useCustomHotkeys"]);
        expect(s.useCustomHotkeys).toBe(false);
        expect(calls).toEqual(["leaveTabMode", "setHotkeys:false"]);
    });

    test("switching the look to Classic does the same", () => {
        const s = tabbedByTheDesktopLayout();
        s.reviewLook = "classic";
        const { host, calls } = fakeHost();
        expect(applyEffects(["reviewLook"], s, host, desktop)).toEqual(["useCustomHotkeys"]);
        expect(s.useCustomHotkeys).toBe(false);
        expect(calls).toEqual(["leaveTabMode", "setHotkeys:false"]);
    });

    test("when the device's tab key is on, neither change touches the hotkeys", () => {
        for (const [key, change] of [
            ["desktopLayout", (s: StudioSettings) => (s.desktopLayout = false)],
            ["reviewLook", (s: StudioSettings) => (s.reviewLook = "classic")],
        ] as const) {
            const s = tabbedByTheDesktopLayout();
            s.openViewInNewTab = true;
            change(s);
            const { host, calls } = fakeHost();
            expect(applyEffects([key], s, host, desktop)).toEqual([]);
            expect(s.useCustomHotkeys).toBe(true);
            expect(calls).toEqual([]);
        }
    });

    test("a change that leaves the review opening in a tab touches nothing", () => {
        const s = tabbedByTheDesktopLayout();
        const { host, calls } = fakeHost();
        expect(applyEffects(["desktopLayout", "reviewLook"], s, host, desktop)).toEqual([]);
        expect(s.useCustomHotkeys).toBe(true);
        expect(calls).toEqual([]);
    });

    test("with hotkeys off, leaving tab mode only leaves tab mode", () => {
        const s = tabbedByTheDesktopLayout();
        s.useCustomHotkeys = false;
        s.desktopLayout = false;
        const { host, calls } = fakeHost();
        expect(applyEffects(["desktopLayout"], s, host, desktop)).toEqual([]);
        expect(calls).toEqual(["leaveTabMode"]);
    });

    test("on a phone the desktop layout never counts, so only the phone's tab key decides", () => {
        const s = tabbedByTheDesktopLayout();
        s.openViewInNewTabMobile = false;
        const { host, calls } = fakeHost();
        applyEffects(["reviewLook"], s, host, { isMobile: true });
        expect(calls).toEqual(["leaveTabMode"]);

        const tabbed = tabbedByTheDesktopLayout();
        tabbed.openViewInNewTabMobile = true;
        const again = fakeHost();
        applyEffects(["reviewLook"], tabbed, again.host, { isMobile: true });
        expect(again.calls).toEqual([]);
    });
});

describe("applyReloadedSettings: everything a reload of the settings has to redo", () => {
    test("runs the scheduler, math macro, reminders, status bar, day start, parser and hotkey effects once each", () => {
        const { host, calls } = fakeHost();
        const settings = {
            ...cloneDefaultSettings(),
            aiProvider: "openai" as const,
            aiModel: "keep-me",
        };
        applyReloadedSettings(settings, host, desktop);
        expect(calls).toEqual([
            "refreshScheduler",
            "rebuildScheduler",
            "setMathMacro:false",
            "restartReminders",
            "refreshStatusBar",
            "applyStartOfDay:00:00:00",
            "setParserDebug:false",
            "setHotkeys:false",
        ]);
        // The model is not reset to the provider's default, as it is when a person switches provider
        expect(settings.aiModel).toBe("keep-me");
    });

    test("an effect that throws is reported and the others still run", () => {
        const { host, calls } = fakeHost();
        host.rebuildScheduler = () => {
            throw new Error("no scheduler");
        };
        const failed: string[] = [];
        applyReloadedSettings(cloneDefaultSettings(), host, desktop, (effect) =>
            failed.push(effect),
        );
        expect(failed).toEqual(["rebuildScheduler"]);
        expect(calls).toContain("restartReminders");
    });
});
