/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- a loose stand-in for the obsidian module */
// A wider obsidian mock than the repo's: the DOM helpers Obsidian adds to HTMLElement, ItemView, Menu, Notice and the
// modals the note review code uses. It records what happens so a test can read it back (`__log`).
const moment = require("moment");

const log = { notices: [], modals: [], menus: [] };

class Notice {
    constructor(message) {
        log.notices.push(String(message));
    }
}

class Modal {
    constructor(app) {
        this.app = app;
        this.opened = false;
        this.closed = false;
        this.contentEl = document.createElement("div");
        this.titleEl = document.createElement("div");
    }
    open() {
        this.opened = true;
        log.modals.push(this);
    }
    close() {
        this.closed = true;
    }
    setTitle() {
        return this;
    }
    setContent() {
        return this;
    }
}

class FuzzySuggestModal extends Modal {
    setPlaceholder() {}
}
class Setting {
    setClass() {
        return this;
    }
    addButton() {
        return this;
    }
}

class Menu {
    constructor() {
        this.items = [];
        this.shown = 0;
        log.menus.push(this);
    }
    addItem(cb) {
        const item = {
            title: null,
            icon: null,
            warning: false,
            click: null,
            setTitle(t) {
                this.title = t;
                return this;
            },
            setIcon(i) {
                this.icon = i;
                return this;
            },
            setWarning(w) {
                this.warning = w;
                return this;
            },
            onClick(f) {
                this.click = f;
                return this;
            },
        };
        cb(item);
        this.items.push(item);
        return this;
    }
    addSeparator() {
        this.items.push({ separator: true });
        return this;
    }
    showAtPosition() {
        this.shown++;
        return this;
    }
    showAtMouseEvent() {
        this.shown++;
        return this;
    }
}

function setIcon(el, name) {
    el.setAttribute("data-icon", name);
}

class ItemView {
    constructor(leaf) {
        this.leaf = leaf;
        this.app = leaf.app;
        this.contentEl = document.createElement("div");
        this.registered = [];
    }
    registerEvent(ref) {
        this.registered.push(ref);
    }
}

class TFile {}
class Plugin {}
class PluginSettingTab {}
const Platform = { isMobile: false };

// Obsidian's HTMLElement extensions, as far as the review pane uses them
const P = HTMLElement.prototype;
function applyInfo(el, o) {
    if (typeof o === "string") el.className = o;
    else if (o && o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
}
P.createDiv = function (o) {
    const d = document.createElement("div");
    applyInfo(d, o);
    if (o && o.text) d.textContent = o.text;
    this.appendChild(d);
    return d;
};
P.createEl = function (tag, o) {
    const d = document.createElement(tag);
    applyInfo(d, o);
    if (o && o.text) d.textContent = o.text;
    this.appendChild(d);
    return d;
};
P.createSpan = function (o) {
    return this.createEl("span", o);
};
P.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
};
P.addClass = function (...c) {
    this.classList.add(...c);
};
P.removeClass = function (...c) {
    this.classList.remove(...c);
};
P.toggleClass = function (c, on) {
    this.classList.toggle(c, on);
};
P.hasClass = function (c) {
    return this.classList.contains(c);
};
P.setText = function (t) {
    this.textContent = t;
};
P.setCssProps = function (props) {
    for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
};

module.exports = {
    moment,
    Notice,
    Modal,
    FuzzySuggestModal,
    Setting,
    Menu,
    setIcon,
    ItemView,
    TFile,
    Plugin,
    PluginSettingTab,
    Platform,
    __log: log,
};
