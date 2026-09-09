import { afterEach, describe, expect, it, vi } from "vitest";

import { extensionCommandRouter } from "../../src/services/extensionCommandRouter";
import { parseContributionSnapshot } from "../../src/services/extensionProtocol";
import { ExtensionShortcutRegistry } from "../../src/services/extensionShortcutRegistry";

vi.mock("../../src/services/extensionCommandRouter", () => ({
    extensionCommandRouter: { execute: vi.fn().mockResolvedValue(undefined) },
}));

const commandId = "neuro.official/ocr.recognize-selected-unit";
const createRegistry = () => {
    const registry = new ExtensionShortcutRegistry();
    const rejected = registry.applySnapshot(parseContributionSnapshot({
        protocol: "loom.extension.v1", apiVersion: "1.0", generation: 1,
        plugins: [{ id: "neuro.official/ocr", version: "1.3.1", packageDigest: "a".repeat(64),
            trustStatus: "trusted", permissionGrantDigest: "b".repeat(64), scopeId: "ocr-test" }],
        contributions: {
            shortcuts: [{ id: "neuro.official/ocr.shortcut.recognize", pluginId: "neuro.official/ocr",
                scopeId: "ocr-test", commandId, payload: { schema: null, payload: { keys: "ctrl+4", global: true } } }],
            commands: [], menus: [], settings: [], dataTypes: [], renderers: [], unitOverlays: [],
            backgroundTasks: [], resourceProviders: [], diagnostics: [], eventSubscriptions: [],
        },
    }));
    expect(rejected).toEqual([]);
    return registry;
};
const keyDown = () => new KeyboardEvent("keydown", {
    key: "4", ctrlKey: true, bubbles: true, cancelable: true,
});
const dispatch = (target: EventTarget) => {
    const registry = createRegistry();
    const event = keyDown();
    target.addEventListener("keydown", registry.handleKeyDown as EventListener);
    try { target.dispatchEvent(event); } finally {
        target.removeEventListener("keydown", registry.handleKeyDown as EventListener);
    }
    return event;
};

describe("extension shortcut event target boundary", () => {
    afterEach(() => vi.clearAllMocks());

    it.each(["window", "document", "element", "event-target"])("dispatches Ctrl+4 from %s exactly once", (kind) => {
        const target = kind === "window" ? window : kind === "document" ? document
            : kind === "element" ? document.createElement("div") : new EventTarget();
        const event = dispatch(target);
        expect(event.defaultPrevented).toBe(true);
        expect(extensionCommandRouter.execute).toHaveBeenCalledExactlyOnceWith(commandId);
    });

    it("accepts a directly handled event without a target", () => {
        const event = keyDown();
        createRegistry().handleKeyDown(event);
        expect(event.target).toBeNull();
        expect(extensionCommandRouter.execute).toHaveBeenCalledExactlyOnceWith(commandId);
    });

    it.each(["input", "textarea", "select"])("leaves %s editing alone", (tag) => {
        const event = dispatch(document.createElement(tag));
        expect(event.defaultPrevented).toBe(false);
        expect(extensionCommandRouter.execute).not.toHaveBeenCalled();
    });

    it("preserves contenteditable exclusion", () => {
        const target = document.createElement("div");
        Object.defineProperty(target, "isContentEditable", { value: true });
        expect(dispatch(target).defaultPrevented).toBe(false);
        expect(extensionCommandRouter.execute).not.toHaveBeenCalled();
    });

    it.each(["span", "svg"])("preserves ignored subtree exclusion for %s", (tag) => {
        const parent = document.createElement("div");
        parent.dataset.hookGlobalShortcuts = "ignore";
        const child = tag === "svg" ? document.createElementNS("http://www.w3.org/2000/svg", "svg")
            : document.createElement(tag);
        parent.append(child);
        expect(dispatch(child).defaultPrevented).toBe(false);
        expect(extensionCommandRouter.execute).not.toHaveBeenCalled();
    });

    it("does not consume Ctrl+2 after the OCR shortcut migration", () => {
        const event = new KeyboardEvent("keydown", { key: "2", code: "Digit2", ctrlKey: true, cancelable: true });
        createRegistry().handleKeyDown(event);
        expect(event.defaultPrevented).toBe(false);
        expect(extensionCommandRouter.execute).not.toHaveBeenCalled();
    });
});
