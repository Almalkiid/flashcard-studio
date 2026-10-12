import { Platform } from "obsidian";

interface ElectronWindow {
    isMinimized(): boolean;
    restore(): void;
    show(): void;
    focus(): void;
    moveTop(): void;
}

interface ElectronRemote {
    getCurrentWindow(): ElectronWindow;
    app?: { dock?: { bounce(type: string): number } };
}

/**
 * Electron's remote module, which Obsidian's desktop app exposes to plugins without documenting it. Null on a phone
 * and wherever it is not there, so everything built on it is a best effort.
 */
function electronRemote(): ElectronRemote | null {
    if (!Platform.isDesktopApp) return null;
    const load = (window as unknown as { require?: (id: string) => unknown }).require;
    if (load === undefined) return null;
    for (const id of ["@electron/remote", "electron"]) {
        try {
            const loaded = load(id) as Partial<ElectronRemote> & { remote?: ElectronRemote };
            const remote = loaded.getCurrentWindow !== undefined ? loaded : loaded.remote;
            if (remote?.getCurrentWindow !== undefined) return remote as ElectronRemote;
        } catch {
            // This module is not there in this build; try the next
        }
    }
    return null;
}

/** Raises Obsidian's window above the others, for a reminder that opens a review while another app is in front. */
export function bringWindowToFront(): void {
    if (!Platform.isDesktopApp) return;
    activeWindow.focus();
    try {
        const win = electronRemote()?.getCurrentWindow();
        if (win === undefined) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        win.moveTop();
    } catch {
        // Raising the window is a courtesy, never a reason to fail
    }
}

/** Bounces the Dock icon once (macOS), to draw the eye to a reminder. */
export function bounceDock(): void {
    try {
        electronRemote()?.app?.dock?.bounce("informational");
    } catch {
        // There is no Dock on this system
    }
}

/** A short, quiet beep (880 Hz for 0.35 s). Does nothing where the browser will not start audio on its own. */
export async function playBeep(): Promise<void> {
    const Context: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Context === undefined) return;
    const context = new Context();
    try {
        if (context.state === "suspended") await context.resume();
        if (context.state !== "running") return;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 880;
        // A 20 ms ramp up keeps the start from clicking
        gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.linearRampToValueAtTime(0.08, context.currentTime + 0.02);
        oscillator.connect(gain).connect(context.destination);
        const ended = new Promise<void>((resolve) => {
            oscillator.onended = () => resolve();
        });
        oscillator.start();
        oscillator.stop(context.currentTime + 0.35);
        await ended;
    } finally {
        await context.close();
    }
}
