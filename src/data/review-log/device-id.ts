import { App, Platform } from "obsidian";

import { generateCardId } from "src/data/card-meta";

const DEVICE_ID_KEY = "cardwright-device-id";
const DEVICE_ID_PATTERN = /^[a-z]+-[0-9a-z]{4}$/;

function platformName(): string {
    if (Platform.isIosApp) return Platform.isTablet ? "ipad" : "iphone";
    if (Platform.isAndroidApp) return "android";
    if (Platform.isMacOS) return "mac";
    if (Platform.isWin) return "windows";
    return "linux";
}

/**
 * Returns this device's id, e.g. `iphone-81c2`, creating it on first use.
 *
 * It is kept in Obsidian's per-vault local storage, which is not synced, so each device keeps its own id and
 * writes only its own review log files.
 */
export function getDeviceId(app: App): string {
    const existing: unknown = app.loadLocalStorage(DEVICE_ID_KEY);
    if (typeof existing === "string" && DEVICE_ID_PATTERN.test(existing)) return existing;

    const id = `${platformName()}-${generateCardId().slice(0, 4)}`;
    app.saveLocalStorage(DEVICE_ID_KEY, id);
    return id;
}
