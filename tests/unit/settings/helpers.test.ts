import type { ExtraButtonComponent, SettingDefinitionItem } from "obsidian";

import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import type { SettingsContext } from "src/settings/context";
import {
    bindKeys,
    coveredKeys,
    distinctEntries,
    removeEntry,
    restoreDefaultsButton,
} from "src/settings/definitions/helpers";
import type FlashcardStudioPlugin from "src/studio-plugin";

import { fakeContext } from "../helpers/fake-settings-context";

describe("distinctEntries and removeEntry", () => {
    test("each entry shows once, in the order it was first stored, and the stored list is not touched", () => {
        const stored = ["a", "b", "a", "c", "b"];
        expect(distinctEntries(stored)).toEqual(["a", "b", "c"]);
        expect(stored).toEqual(["a", "b", "a", "c", "b"]);
        expect(distinctEntries([])).toEqual([]);
    });

    test("removing an entry takes out every copy of it, in the list itself, and nothing else", () => {
        const stored = ["a", "b", "a", "c", "a"];
        removeEntry(stored, "a");
        expect(stored).toEqual(["b", "c"]);
        removeEntry(stored, "missing");
        expect(stored).toEqual(["b", "c"]);
    });
});

describe("coveredKeys", () => {
    test("a control covers the stored keys behind it, including both keys of a per-device control", () => {
        const items: SettingDefinitionItem[] = [
            { name: "Cards a day", control: { type: "number", key: "newCardsPerDay" } },
            {
                name: "Height",
                control: { type: "slider", key: "windowHeight", min: 1, max: 2, step: 1 },
            },
            {
                name: "Easy bonus",
                control: { type: "slider", key: "easyBonus", min: 1, max: 2, step: 1 },
            },
        ];
        expect(coveredKeys(items)).toEqual(
            new Set([
                "newCardsPerDay",
                "flashcardHeightPercentage",
                "flashcardHeightPercentageMobile",
                "easyBonus",
            ]),
        );
    });

    test("keys bound to render, action and list definitions are covered", () => {
        const items: SettingDefinitionItem[] = [
            bindKeys<SettingDefinitionItem>(["algorithm", "fsrsWeights"], {
                name: "Optimize",
                render: (): void => undefined,
            }),
            bindKeys<SettingDefinitionItem>(["showStatusBar"], {
                name: "Move",
                action: (): void => undefined,
            }),
            bindKeys<SettingDefinitionItem>(["noteFoldersToIgnore"], {
                type: "list",
                items: [],
            }),
        ];
        expect(coveredKeys(items)).toEqual(
            new Set(["algorithm", "fsrsWeights", "showStatusBar", "noteFoldersToIgnore"]),
        );
    });

    test("it walks groups, lists and nested pages", () => {
        const items: SettingDefinitionItem[] = [
            {
                type: "group",
                items: [{ name: "A", control: { type: "toggle", key: "burySiblingCards" } }],
            },
            {
                type: "page",
                name: "Outer",
                items: [
                    { name: "B", control: { type: "toggle", key: "showStatusBar" } },
                    {
                        type: "page",
                        name: "Inner",
                        items: [
                            {
                                type: "group",
                                items: [
                                    { name: "C", control: { type: "toggle", key: "latexClozes" } },
                                ],
                            },
                        ],
                    },
                ],
            },
        ];
        expect(coveredKeys(items)).toEqual(
            new Set(["burySiblingCards", "showStatusBar", "latexClozes"]),
        );
    });

    test("a page built by a factory is covered through bindKeys", () => {
        const items: SettingDefinitionItem[] = [
            bindKeys<SettingDefinitionItem>(["calloutCardTypes"], {
                type: "page",
                name: "Voices",
                page: () => {
                    throw new Error("must not be opened by the walk");
                },
            }),
        ];
        expect(coveredKeys(items)).toEqual(new Set(["calloutCardTypes"]));
    });

    test("a definition nobody bound covers nothing", () => {
        expect(coveredKeys([{ name: "Note", desc: "Only text." }]).size).toBe(0);
    });

    test("bindKeys hands back the same object", () => {
        const def = { name: "x" };
        expect(bindKeys(["algorithm"], def)).toBe(def);
    });
});

describe("fakeContext", () => {
    test("overrides replace the defaults, so a test can ask for a phone or its own plugin", () => {
        const plugin = { name: "double" } as unknown as FlashcardStudioPlugin;
        const { ctx, settings } = fakeContext(undefined, { env: { isMobile: true }, plugin });
        expect(ctx.env.isMobile).toBe(true);
        expect(ctx.plugin).toBe(plugin);
        expect(ctx.settings).toBe(settings);
    });
});

describe("restoreDefaultsButton", () => {
    function press(ctx: SettingsContext, keys: Parameters<typeof restoreDefaultsButton>[1]) {
        const calls: string[] = [];
        let clicked: (() => void) | undefined;
        const button = {
            setIcon: (icon: string) => (calls.push(`icon:${icon}`), button),
            setTooltip: (tip: string) => (calls.push(`tooltip:${tip}`), button),
            onClick: (fn: () => void) => ((clicked = fn), button),
        };
        restoreDefaultsButton(ctx, keys)(button as unknown as ExtraButtonComponent);
        return { calls, click: () => clicked?.() };
    }

    test("it looks like a restore button", () => {
        const { ctx } = fakeContext();
        expect(press(ctx, ["newCardsPerDay"]).calls).toEqual([
            "icon:rotate-ccw",
            "tooltip:Restore defaults",
        ]);
    });

    test("clicking asks first and changes nothing until confirmed", () => {
        const { ctx, settings, mocks } = fakeContext();
        settings.newCardsPerDay = 99;
        press(ctx, ["newCardsPerDay"]).click();
        expect(mocks.confirm).toHaveBeenCalledWith(
            "Restore defaults?",
            "These options go back to how a new install starts.",
            expect.any(Function),
        );
        expect(settings.newCardsPerDay).toBe(99);
        expect(mocks.commit).not.toHaveBeenCalled();
    });

    test("confirming copies fresh-install values for its keys only, then commits and rebuilds", async () => {
        const { ctx, settings, mocks } = fakeContext();
        settings.newCardsPerDay = 99;
        settings.algorithm = SchedulerKind.SM2;
        settings.answerKeys = "original";

        press(ctx, ["newCardsPerDay", "algorithm"]).click();
        await mocks.confirm.mock.calls[0][2]();

        expect(settings.newCardsPerDay).toBe(DEFAULT_SETTINGS.newCardsPerDay);
        // A new install starts on FSRS, which is not the shipped default.
        expect(settings.algorithm).toBe(SchedulerKind.FSRS);
        // Keys that were not asked for stay as they were (a new install would use "anki").
        expect(settings.answerKeys).toBe("original");
        expect(mocks.commit).toHaveBeenCalledWith(["newCardsPerDay", "algorithm"]);
        expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    });
});
