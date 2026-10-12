import type { ExtraButtonComponent, SettingDefinitionItem } from "obsidian";

import type { StudioSettings } from "src/data/settings-model";
import { StoredKey, storedKeysOf } from "src/settings/adapters";
import type { SettingsContext } from "src/settings/context";
import { freshInstallSettings } from "src/settings/fresh-defaults";

/** The stored keys that render, action, list and page definitions write; a control already says its own. */
const BOUND_KEYS = new WeakMap<object, StoredKey[]>();

/**
 * Records which stored keys a render, action, list or page definition writes, so the coverage check can see them.
 *
 * Two traps. The binding belongs to this exact object: spreading it, copying it or wrapping it in another object
 * loses the binding, so bind the final object. And a literal such as `{ type: "list", ... }` widens `type` to
 * `string` unless you give the type argument: `bindKeys<SettingDefinitionList>([...], { type: "list", ... })`.
 */
export function bindKeys<T extends object>(keys: StoredKey[], def: T): T {
    BOUND_KEYS.set(def, keys);
    return def;
}

/** Every stored key the definitions can write, looking inside groups, lists and pages. */
export function coveredKeys(items: SettingDefinitionItem[]): Set<StoredKey> {
    const covered = new Set<StoredKey>();
    const walk = (list: readonly SettingDefinitionItem[]) => {
        for (const item of list) {
            for (const key of BOUND_KEYS.get(item) ?? []) covered.add(key);
            if ("control" in item && item.control !== undefined) {
                for (const key of storedKeysOf(item.control.key)) covered.add(key);
            }
            if ("items" in item && item.items !== undefined) walk(item.items);
        }
    };
    walk(items);
    return covered;
}

/** The entries of a stored list as a list page shows them: each once, in the order it was first stored. */
export function distinctEntries(list: readonly string[]): string[] {
    return [...new Set(list)];
}

/** Takes every copy of `entry` out of a stored list, in the list itself, so a deleted row does not come back. */
export function removeEntry(list: string[], entry: string): void {
    for (let index = list.length - 1; index >= 0; index--) {
        if (list[index] === entry) list.splice(index, 1);
    }
}

function copyKey<K extends StoredKey>(to: StudioSettings, from: StudioSettings, key: K): void {
    to[key] = from[key];
}

/** A header button that puts the given keys back to how a new install starts, after asking. */
export function restoreDefaultsButton(
    ctx: SettingsContext,
    keys: StoredKey[],
): (button: ExtraButtonComponent) => void {
    return (button) => {
        button
            .setIcon("rotate-ccw")
            .setTooltip("Restore defaults")
            .onClick(() => {
                ctx.confirm(
                    "Restore defaults?",
                    "These options go back to how a new install starts.",
                    async () => {
                        const fresh = freshInstallSettings();
                        for (const key of keys) copyKey(ctx.settings, fresh, key);
                        await ctx.commit(keys);
                        ctx.rebuild();
                    },
                );
            });
    };
}
