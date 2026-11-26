import { cloneDefaultSettings, upgradeSettings } from "src/data/settings-model";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { freshInstallSettings, resetSettingsInPlace } from "src/settings/fresh-defaults";

test("a fresh install starts on FSRS with Anki keys and fuzz", () => {
    const s = freshInstallSettings();
    expect(s.algorithm).toBe(SchedulerKind.FSRS);
    expect(s.answerKeys).toBe("anki");
    expect(s.fsrsEnableFuzz).toBe(true);
    expect(s.fsrsLoadBalance).toBe(false);
    expect(s.fsrsEasyDays).toEqual([]);
    expect(freshInstallSettings().flashcardTags).not.toBe(s.flashcardTags);
});

test("reset keeps the same object, installs fresh-install values and reports what changed", () => {
    const s = cloneDefaultSettings();
    s.newCardsPerDay = 5;
    (s as unknown as Record<string, unknown>).someFutureKey = 1;
    const same = s;
    const changed = resetSettingsInPlace(s);
    expect(s).toBe(same);
    expect(s.newCardsPerDay).toBe(20);
    expect(s.algorithm).toBe(SchedulerKind.FSRS);
    expect(changed).toEqual(
        expect.arrayContaining(["newCardsPerDay", "algorithm", "answerKeys", "fsrsEnableFuzz"]),
    );
    expect(changed).not.toContain("flashcardTags");
    expect((s as unknown as Record<string, unknown>).someFutureKey).toBe(1);
});

describe("FSRS version (issue #27)", () => {
    test("a fresh install starts on FSRS-7; settings saved without a version are FSRS-6", () => {
        expect(freshInstallSettings().fsrsVersion).toBe(7);
        expect(cloneDefaultSettings().fsrsVersion).toBe(6);
    });

    test.each([
        [undefined, 6],
        [6, 6],
        [7, 7],
        ["7", 6],
        [8, 6],
    ])("upgrading saved settings with fsrsVersion %p gives %p", (saved, expected) => {
        const s = cloneDefaultSettings() as unknown as Record<string, unknown>;
        s.fsrsVersion = saved;
        upgradeSettings(s as unknown as ReturnType<typeof cloneDefaultSettings>);
        expect(s.fsrsVersion).toBe(expected);
    });
});
