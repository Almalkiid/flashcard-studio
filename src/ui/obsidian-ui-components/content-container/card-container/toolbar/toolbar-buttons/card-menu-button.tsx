import { Menu } from "obsidian";

import { t } from "src/lang/helpers";
import { CardActions, FLAG_COUNT } from "src/ui/card-actions";
import MenuButtonComponent from "src/ui/obsidian-ui-components/content-container/menu-button";

export default class CardMenuButtonComponent extends MenuButtonComponent {
    private isResetButtonDisabled: boolean;
    public constructor(
        container: HTMLElement,
        isExtended: boolean,
        showDeleteButton: boolean,
        isModal: boolean,
        isResetButtonDisabled: boolean,
        deleteCurrentCard: () => void,
        editClickHandler: () => void,
        jumpToCurrentCard: () => Promise<void>,
        displayCurrentCardInfoNotice: () => void,
        skipCurrentCard: () => void,
        onOpenResetModalClick: () => void,
        actions: CardActions | null,
        closeModal?: () => void,
        classNames?: string[],
    ) {
        super(
            container,
            (evt: MouseEvent) => {
                const cardMenu = new Menu();

                this.buildMenu(
                    cardMenu,
                    showDeleteButton,
                    isModal,
                    isExtended,
                    editClickHandler,
                    onOpenResetModalClick,
                    skipCurrentCard,
                    jumpToCurrentCard,
                    displayCurrentCardInfoNotice,
                    deleteCurrentCard,
                    closeModal,
                );
                if (actions) this.addCardActions(cardMenu, actions, evt);

                cardMenu.showAtMouseEvent(evt);
            },
            classNames,
        );
        this.isResetButtonDisabled = isResetButtonDisabled;
    }

    public setResetButtonDisabled(disabled: boolean) {
        this.isResetButtonDisabled = disabled;
    }

    private buildMenu(
        cardMenu: Menu,
        showDeleteButton: boolean,
        isModal: boolean,
        isExtended: boolean,
        editClickHandler: () => void,
        onOpenResetModalClick: () => void,
        skipCurrentCard: () => void,
        jumpToCurrentCard: () => Promise<void>,
        displayCurrentCardInfoNotice: () => void,
        deleteCurrentCard: () => void,
        closeModal?: () => void,
    ) {
        if (isExtended) {
            cardMenu.addItem((item) => {
                item.setTitle(t("EDIT_CARD"))
                    .setIcon("pencil")
                    .onClick(() => {
                        editClickHandler();
                    });
            });
            cardMenu.addItem((item) => {
                item.setTitle(t("RESET_CARD_PROGRESS"))
                    .setIcon("reset")
                    .onClick(() => {
                        onOpenResetModalClick();
                    })
                    .setDisabled(this.isResetButtonDisabled);
            });
            cardMenu.addItem((item) => {
                item.setTitle(t("SKIP"))
                    .setIcon("chevrons-right")
                    .onClick(() => {
                        skipCurrentCard();
                    });
            });
        }

        if (isModal) {
            cardMenu.addItem((item) => {
                item.setTitle(t("OPEN_IN_BACKGROUND"))
                    .setIcon("send-to-back")
                    .onClick(async () => {
                        // Doesn't close modal, just opens in background and focuses
                        await jumpToCurrentCard();
                    });
            });
            cardMenu.addItem((item) => {
                item.setTitle(t("JUMP_TO_AND_CLOSE"))
                    .setIcon("arrow-up-right")
                    .onClick(async () => {
                        await jumpToCurrentCard();
                        if (closeModal) {
                            closeModal();
                        }
                    });
            });
        } else {
            cardMenu.addItem((item) => {
                item.setTitle(t("JUMP_TO"))
                    .setIcon("arrow-up-right")
                    .onClick(async () => {
                        await jumpToCurrentCard();
                    });
            });
        }
        cardMenu.addItem((item) => {
            item.setTitle(t("VIEW_CARD_INFO"))
                .setIcon("info")
                .onClick(() => {
                    displayCurrentCardInfoNotice();
                });
        });
        if (showDeleteButton) {
            cardMenu.addItem((item) => {
                item.setTitle(t("DELETE_CARD"))
                    .setIcon("trash")
                    .onClick(() => {
                        deleteCurrentCard();
                    });
            });
        }
    }

    private addCardActions(cardMenu: Menu, actions: CardActions, evt: MouseEvent) {
        cardMenu.addSeparator();
        cardMenu.addItem((item) => {
            item.setTitle(t("UNDO_LAST_ANSWER"))
                .setIcon("undo-2")
                .setDisabled(!actions.canUndo())
                .onClick(() => void actions.undo());
        });
        cardMenu.addItem((item) => {
            item.setTitle(t("BURY_CARD"))
                .setIcon("eye-off")
                .onClick(() => void actions.bury());
        });
        cardMenu.addItem((item) => {
            item.setTitle(t("SUSPEND_CARD"))
                .setIcon("pause-circle")
                .onClick(() => void actions.suspend());
        });
        cardMenu.addItem((item) => {
            item.setTitle(t("FLAG_CARD"))
                .setIcon("flag")
                .onClick(() => {
                    // Obsidian menus have no public submenu API, so the colours open as a second menu in place
                    const flagMenu = new Menu();
                    const current = actions.currentFlag();
                    for (let flag = 1; flag <= FLAG_COUNT; flag++) {
                        flagMenu.addItem((flagItem) => {
                            flagItem
                                .setTitle(t(`FLAG_${flag}` as "FLAG_1"))
                                .setIcon("flag")
                                .setChecked(current === flag)
                                .onClick(() => void actions.setFlag(flag));
                        });
                    }
                    flagMenu.addSeparator();
                    flagMenu.addItem((flagItem) => {
                        flagItem
                            .setTitle(t("REMOVE_FLAG"))
                            .setIcon("flag-off")
                            .setDisabled(current === 0)
                            .onClick(() => void actions.setFlag(0));
                    });
                    flagMenu.showAtPosition({ x: evt.clientX, y: evt.clientY });
                });
        });
    }
}
