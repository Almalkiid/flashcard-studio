import { Menu } from "obsidian";

import { t } from "src/lang/translate";
import { CardActions, FLAG_COUNT } from "src/ui/card-actions";
import StudioButton from "src/ui/studio-button";

/** The "Type answers" switch of the study session, shown in the card menu. */
export interface TypeAnswersToggle {
    isOn: () => boolean;
    toggle: () => void;
}

/**
 * The three-dots button. Its menu holds what the toolbar has no room for (Edit, Reset and Skip, in the extended
 * variant), the ways to jump to the note, the card info, delete, and the card actions.
 */
export default class CardMenuButtonComponent extends StudioButton {
    public typeAnswersToggle: TypeAnswersToggle | null = null;

    constructor(
        container: HTMLElement,
        private readonly isExtended: boolean,
        private readonly showDelete: boolean,
        private readonly isModal: boolean,
        private resetDisabled: boolean,
        private readonly deleteCurrentCard: () => void,
        private readonly editClickHandler: () => void,
        private readonly jumpToCurrentCard: () => Promise<void>,
        private readonly displayCurrentCardInfo: () => void,
        private readonly skipCurrentCard: () => void,
        private readonly onOpenResetModalClick: () => void,
        private readonly actions: CardActions | null,
        private readonly closeModal?: () => void,
        classNames: string[] = [],
    ) {
        super(container, {
            tooltip: t("OPEN_MENU"),
            icon: "ellipsis-vertical",
            classNames: ["fs-menu-dots-button", ...classNames],
        });
        this.onClick((evt) => this.openMenu(evt));
    }

    public setResetButtonDisabled(disabled: boolean): void {
        this.resetDisabled = disabled;
    }

    private openMenu(evt: MouseEvent): void {
        const menu = new Menu();
        const wanted: (MenuEntry | false)[] = [
            ...(this.isExtended ? this.narrowToolbarEntries() : []),
            ...this.jumpEntries(),
            { title: t("VIEW_CARD_INFO"), icon: "info", run: () => this.displayCurrentCardInfo() },
            this.showDelete && {
                title: t("DELETE_CARD"),
                icon: "trash",
                run: () => this.deleteCurrentCard(),
            },
        ];
        addEntries(menu, wanted);
        if (this.actions) this.addCardActions(menu, this.actions, evt);
        this.addStudyOptions(menu);
        menu.showAtMouseEvent(evt);
    }

    /** What the narrow toolbar has no room for. */
    private narrowToolbarEntries(): MenuEntry[] {
        return [
            { title: t("EDIT_CARD"), icon: "pencil", run: () => this.editClickHandler() },
            {
                title: t("RESET_CARD_PROGRESS"),
                icon: "history",
                disabled: this.resetDisabled,
                run: () => this.onOpenResetModalClick(),
            },
            { title: t("SKIP"), icon: "chevrons-right", run: () => this.skipCurrentCard() },
        ];
    }

    private jumpEntries(): MenuEntry[] {
        if (!this.isModal) {
            return [
                {
                    title: t("JUMP_TO"),
                    icon: "arrow-up-right",
                    run: () => void this.jumpToCurrentCard(),
                },
            ];
        }
        return [
            {
                title: t("OPEN_IN_BACKGROUND"),
                icon: "send-to-back",
                run: () => void this.jumpToCurrentCard(),
            },
            {
                title: t("JUMP_TO_AND_CLOSE"),
                icon: "arrow-up-right",
                run: () => void this.jumpToCurrentCard().then(() => this.closeModal?.()),
            },
        ];
    }

    private addStudyOptions(menu: Menu): void {
        const toggle = this.typeAnswersToggle;
        if (!toggle) return;
        menu.addSeparator();
        addEntries(menu, [
            {
                title: t("TYPE_ANSWERS"),
                icon: "keyboard",
                checked: toggle.isOn(),
                run: () => toggle.toggle(),
            },
        ]);
    }

    private addCardActions(menu: Menu, actions: CardActions, evt: MouseEvent): void {
        menu.addSeparator();
        addEntries(menu, [
            {
                title: t("UNDO_LAST_ANSWER"),
                icon: "undo-2",
                disabled: !actions.canUndo(),
                run: () => void actions.undo(),
            },
            { title: t("BURY_CARD"), icon: "eye-off", run: () => void actions.bury() },
            { title: t("SUSPEND_CARD"), icon: "pause-circle", run: () => void actions.suspend() },
            {
                title: t("FLAG_CARD"),
                icon: "flag",
                // Obsidian menus have no public submenu API, so the colours open as a second menu in place
                run: () => this.openFlagMenu(actions, evt),
            },
        ]);
    }

    private openFlagMenu(actions: CardActions, evt: MouseEvent): void {
        const current = actions.currentFlag();
        const colours: MenuEntry[] = Array.from({ length: FLAG_COUNT }, (_unused, i) => ({
            title: t(`FLAG_${i + 1}` as "FLAG_1"),
            icon: "flag",
            checked: current === i + 1,
            run: () => void actions.setFlag(i + 1),
        }));
        const flagMenu = new Menu();
        addEntries(flagMenu, colours);
        flagMenu.addSeparator();
        addEntries(flagMenu, [
            {
                title: t("REMOVE_FLAG"),
                icon: "flag-off",
                disabled: current === 0,
                run: () => void actions.setFlag(0),
            },
        ]);
        flagMenu.showAtPosition({ x: evt.clientX, y: evt.clientY });
    }
}

/** One line of a menu. */
interface MenuEntry {
    title: string;
    icon: string;
    run: () => void;
    disabled?: boolean;
    checked?: boolean;
}

/** Adds the entries in order; a `false` among them is a line that is not wanted. */
function addEntries(menu: Menu, entries: (MenuEntry | false)[]): void {
    for (const entry of entries) {
        if (!entry) continue;
        menu.addItem((item) => {
            item.setTitle(entry.title).setIcon(entry.icon);
            if (entry.disabled !== undefined) item.setDisabled(entry.disabled);
            if (entry.checked !== undefined) item.setChecked(entry.checked);
            item.onClick(entry.run);
        });
    }
}
