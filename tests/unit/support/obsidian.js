/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- a loose stand-in for the obsidian module */
// The `obsidian` module for the unit tests: the names the plugin imports as values, as classes that do nothing,
// so that a module can be loaded. A test that needs more overrides it with jest.mock("obsidian", factory).
const moment = require("moment");

class Component {
    load() {}
    unload() {}
    onload() {}
    onunload() {}
    addChild(child) {
        return child;
    }
    register() {}
    registerEvent() {}
    registerDomEvent() {}
    registerInterval() {
        return 0;
    }
}

// A mock function, so a test can read the messages back: expect(Notice).toHaveBeenCalledWith("...")
const Notice = jest.fn();

class Modal extends Component {
    constructor(app) {
        super();
        this.app = app;
        this.contentEl = document.createElement("div");
        this.titleEl = document.createElement("div");
        this.modalEl = document.createElement("div");
    }
    open() {
        this.onOpen?.();
    }
    close() {
        this.onClose?.();
    }
    setTitle() {
        return this;
    }
}

class FuzzySuggestModal extends Modal {
    setPlaceholder() {}
}

class ItemView extends Component {
    constructor(leaf) {
        super();
        this.leaf = leaf;
        this.containerEl = document.createElement("div");
        this.contentEl = document.createElement("div");
    }
}

class Plugin extends Component {
    constructor(app, manifest) {
        super();
        this.app = app;
        this.manifest = manifest;
    }
    addCommand() {}
    addRibbonIcon() {
        return document.createElement("div");
    }
    addSettingTab() {}
    addStatusBarItem() {
        return document.createElement("div");
    }
    registerView() {}
    registerMarkdownPostProcessor() {}
    loadData() {
        return Promise.resolve(null);
    }
    saveData() {
        return Promise.resolve();
    }
}

class PluginSettingTab extends Component {
    constructor(app, plugin) {
        super();
        this.app = app;
        this.plugin = plugin;
        this.containerEl = document.createElement("div");
    }
}

class Setting {
    constructor(containerEl) {
        this.containerEl = containerEl;
    }
}

class TAbstractFile {}
class TFile extends TAbstractFile {}
class Vault {}
class WorkspaceLeaf {}
class Menu {}
class MarkdownRenderChild extends Component {}
class MarkdownView {}

const MarkdownRenderer = {
    render: () => Promise.resolve(),
    renderMarkdown: () => Promise.resolve(),
};
const Keymap = { isModEvent: () => false, isModifier: () => false };
const Platform = {
    isMobile: false,
    isDesktop: true,
    isDesktopApp: true,
    isMobileApp: false,
    isPhone: false,
};

module.exports = {
    Component,
    FuzzySuggestModal,
    ItemView,
    Keymap,
    MarkdownRenderChild,
    MarkdownRenderer,
    MarkdownView,
    Menu,
    Modal,
    Notice,
    Platform,
    Plugin,
    PluginSettingTab,
    Setting,
    TAbstractFile,
    TFile,
    Vault,
    WorkspaceLeaf,
    debounce: (fn) => fn,
    finishRenderMath: () => Promise.resolve(),
    getAllTags: (cache) => (cache?.tags ?? []).map((entry) => entry.tag),
    getLanguage: () => "en",
    htmlToMarkdown: (html) => html,
    loadMathJax: () => Promise.resolve(),
    moment,
    normalizePath: (path) => path.replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
    renderMath: () => document.createElement("span"),
    request: () => Promise.resolve(""),
    requestUrl: () =>
        Promise.resolve({ status: 200, text: "", json: {}, arrayBuffer: new ArrayBuffer(0) }),
    setIcon: () => {},
    setTooltip: () => {},
};
