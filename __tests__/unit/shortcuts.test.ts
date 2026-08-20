import { beforeEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { ShortcutManager } from "../../src/services/shortcuts";
import {
    isActionsMenuDismissShortcut,
    shouldIgnoreGlobalShortcut,
    useShortcuts,
} from "../../src/hooks/useShortcuts";

describe("ShortcutManager Hook shortcuts", () => {
    beforeEach(() => {
        ShortcutManager.resetToDefaults();
    });

    it("dispatches Shift+1 to the selected unit actions menu", () => {
        let unitMenuCalls = 0;

        ShortcutManager.setContextProvider(() => "unit-selected");
        ShortcutManager.register("toggle-actions", () => {
            unitMenuCalls += 1;
        });

        const handled = ShortcutManager.handleKeyDown({
            key: "!",
            ctrlKey: false,
            altKey: false,
            shiftKey: true,
            metaKey: false,
            repeat: false,
        } as KeyboardEvent);

        ShortcutManager.unregister("toggle-actions");

        expect(handled).toBe(true);
        expect(unitMenuCalls).toBe(1);
    });

    it("does not dispatch Shift+1 when no unit is selected", () => {
        let unitMenuCalls = 0;

        ShortcutManager.setContextProvider(() => "canvas");
        ShortcutManager.register("toggle-actions", () => {
            unitMenuCalls += 1;
        });

        const handled = ShortcutManager.handleKeyDown({
            key: "!",
            ctrlKey: false,
            altKey: false,
            shiftKey: true,
            metaKey: false,
            repeat: false,
        } as KeyboardEvent);

        ShortcutManager.unregister("toggle-actions");

        expect(handled).toBe(false);
        expect(unitMenuCalls).toBe(0);
    });

    it("defers every shortcut inside editable controls so their local handlers get priority", () => {
        const input = document.createElement("input");
        const textarea = document.createElement("textarea");
        const select = document.createElement("select");
        const shell = document.createElement("div");
        shell.contentEditable = "true";
        const editableChild = document.createElement("span");
        shell.append(editableChild);

        expect(shouldIgnoreGlobalShortcut(input, "Tab")).toBe(true);
        expect(shouldIgnoreGlobalShortcut(textarea, "a")).toBe(true);
        expect(shouldIgnoreGlobalShortcut(select, "Delete")).toBe(true);
        expect(shouldIgnoreGlobalShortcut(editableChild, "Escape")).toBe(true);
    });

    it("lets a focused editor consume Escape before selected-unit deletion", () => {
        const host = document.createElement("div");
        const input = document.createElement("input");
        document.body.append(host);
        let localEscapeCalls = 0;
        let deleteCalls = 0;
        input.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            localEscapeCalls += 1;
            event.preventDefault();
        });
        const dispose = render(() => {
            useShortcuts({
                contextProvider: () => "unit-selected",
                handlers: {
                    onDelete: () => {
                        deleteCalls += 1;
                    },
                },
            });
            return input;
        }, host);

        const escape = new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(escape);

        expect(localEscapeCalls).toBe(1);
        expect(deleteCalls).toBe(0);
        expect(escape.defaultPrevented).toBe(true);
        dispose();
        host.remove();
    });

    it("keeps a blocking dialog ahead of the actions menu and selected-unit shortcuts", () => {
        const host = document.createElement("div");
        document.body.append(host);
        let closeCalls = 0;
        let deleteCalls = 0;
        const dispose = render(() => {
            useShortcuts({
                contextProvider: () => "modal",
                handlers: {
                    onCloseActions: () => {
                        closeCalls += 1;
                        return true;
                    },
                    onDelete: () => {
                        deleteCalls += 1;
                    },
                },
            });
            return document.createElement("div");
        }, host);

        const blockedEvents = ["Escape", "Delete", "Backspace"].map((key) => {
            const event = new KeyboardEvent("keydown", {
                key,
                bubbles: true,
                cancelable: true,
            });
            window.dispatchEvent(event);
            return event;
        });

        expect(closeCalls).toBe(0);
        expect(deleteCalls).toBe(0);
        expect(blockedEvents.every((event) => !event.defaultPrevented)).toBe(true);
        dispose();
        host.remove();
    });

    it("routes Escape, Delete, and Backspace through one contextual delete action", () => {
        let deleteCalls = 0;
        ShortcutManager.setContextProvider(() => "unit-selected");
        const onDelete = () => {
            deleteCalls += 1;
        };
        ShortcutManager.register("delete", onDelete);
        ShortcutManager.register("delete-backspace", onDelete);
        ShortcutManager.register("delete-escape", onDelete);

        for (const key of ["Escape", "Delete", "Backspace"]) {
            expect(ShortcutManager.handleKeyDown(new KeyboardEvent("keydown", { key }))).toBe(true);
        }

        expect(deleteCalls).toBe(3);
    });

    it("recognizes Escape and Shift+1 as active actions-menu dismiss shortcuts", () => {
        expect(isActionsMenuDismissShortcut({
            key: "Escape",
            shiftKey: false,
            ctrlKey: false,
            altKey: false,
            metaKey: false,
        })).toBe(true);
        expect(isActionsMenuDismissShortcut({
            key: "!",
            shiftKey: true,
            ctrlKey: false,
            altKey: false,
            metaKey: false,
        })).toBe(true);
        expect(isActionsMenuDismissShortcut({
            key: "1",
            code: "Digit1",
            shiftKey: true,
            ctrlKey: false,
            altKey: false,
            metaKey: false,
        })).toBe(true);
        expect(isActionsMenuDismissShortcut({
            key: "!",
            shiftKey: true,
            ctrlKey: true,
            altKey: false,
            metaKey: false,
        })).toBe(false);
    });

    it("closes an open actions menu before preserving Escape deletion when the menu is closed", () => {
        const host = document.createElement("div");
        const input = document.createElement("input");
        document.body.append(host);
        let menuOpen = true;
        let closeCalls = 0;
        let deleteCalls = 0;
        const dispose = render(() => {
            useShortcuts({
                contextProvider: () => "unit-selected",
                handlers: {
                    onCloseActions: () => {
                        if (!menuOpen) return false;
                        menuOpen = false;
                        closeCalls += 1;
                        return true;
                    },
                    onDelete: () => {
                        deleteCalls += 1;
                    },
                },
            });
            return input;
        }, host);
        input.focus();

        const closeWithEscape = new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(closeWithEscape);
        expect(closeWithEscape.defaultPrevented).toBe(true);
        expect(closeCalls).toBe(1);
        expect(deleteCalls).toBe(0);

        const deleteWithEscape = new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(deleteWithEscape);
        expect(deleteWithEscape.defaultPrevented).toBe(true);
        expect(closeCalls).toBe(1);
        expect(deleteCalls).toBe(1);

        menuOpen = true;
        const closeWithShiftOne = new KeyboardEvent("keydown", {
            key: "1",
            code: "Digit1",
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(closeWithShiftOne);
        expect(closeWithShiftOne.defaultPrevented).toBe(true);
        expect(closeCalls).toBe(2);
        expect(deleteCalls).toBe(1);

        dispose();
        host.remove();
    });

    it("hot-applies multiple Loom shortcut candidates", () => {
        let calls = 0;
        ShortcutManager.applyLoomSettings({
            shortcuts: {
                toggle_actions: {
                    keys: "Ctrl+K / Shift+9",
                    enabled: true,
                },
            },
        });
        ShortcutManager.setContextProvider(() => "unit-selected");
        ShortcutManager.register("toggle-actions", () => {
            calls += 1;
        });

        expect(ShortcutManager.handleKeyDown(new KeyboardEvent("keydown", {
            key: "k",
            code: "KeyK",
            ctrlKey: true,
        }))).toBe(true);
        expect(ShortcutManager.handleKeyDown(new KeyboardEvent("keydown", {
            key: "(",
            code: "Digit9",
            shiftKey: true,
        }))).toBe(true);
        expect(ShortcutManager.handleKeyDown(new KeyboardEvent("keydown", {
            key: "!",
            code: "Digit1",
            shiftKey: true,
        }))).toBe(false);
        expect(calls).toBe(2);
    });

    it("reuses contextual cancel/delete keys without treating them as a runtime conflict", () => {
        let captureCancels = 0;
        let unitDeletes = 0;
        let context = "capture-selecting";
        ShortcutManager.applyLoomSettings({
            shortcuts: {
                cancel: { keys: "Escape / Delete / Backspace", enabled: true },
                delete_unit: { keys: "Escape / Delete / Backspace", enabled: true },
            },
        });
        ShortcutManager.setContextProvider(() => context);
        ShortcutManager.register("cancel-selection", () => {
            captureCancels += 1;
        });
        ShortcutManager.register("delete", () => {
            unitDeletes += 1;
        });

        expect(ShortcutManager.handleKeyDown(new KeyboardEvent("keydown", { key: "Delete" }))).toBe(true);
        context = "unit-selected";
        expect(ShortcutManager.handleKeyDown(new KeyboardEvent("keydown", { key: "Delete" }))).toBe(true);
        expect(captureCancels).toBe(1);
        expect(unitDeletes).toBe(1);
    });

    it("dispatches configured quick Art bindings only for a selected unit", () => {
        const arts: string[] = [];
        let context = "canvas";
        ShortcutManager.applyLoomSettings({
            quick_bindings: [{ id: "q1", art: "neuro.official/compress", key: "Alt+8 / F8" }],
        });
        ShortcutManager.setContextProvider(() => context);
        ShortcutManager.setQuickBindingHandler((artId) => {
            arts.push(artId);
        });

        expect(ShortcutManager.handleKeyDown(new KeyboardEvent("keydown", {
            key: "8",
            code: "Digit8",
            altKey: true,
        }))).toBe(false);
        context = "unit-selected";
        expect(ShortcutManager.handleKeyDown(new KeyboardEvent("keydown", {
            key: "F8",
            code: "F8",
        }))).toBe(true);
        expect(ShortcutManager.handleKeyDown(new KeyboardEvent("keydown", {
            key: "F8",
            code: "F8",
            repeat: true,
        }))).toBe(true);
        expect(arts).toEqual(["neuro.official/compress"]);
    });

    it("hot-applies mouse gesture modifier combinations", () => {
        ShortcutManager.applyLoomSettings({
            shortcuts: {
                drag_out: { keys: "Alt+拖动", enabled: true },
                control_scale: { keys: "Ctrl+Shift+滚轮", enabled: true },
            },
        });
        const alt = { ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } as MouseEvent;
        const shift = { ctrlKey: false, altKey: false, shiftKey: true, metaKey: false } as MouseEvent;
        const ctrlShift = { ctrlKey: true, altKey: false, shiftKey: true, metaKey: false } as MouseEvent;

        expect(ShortcutManager.isDragModifierActive(alt, "dragOut")).toBe(true);
        expect(ShortcutManager.isDragModifierActive(shift, "dragOut")).toBe(false);
        expect(ShortcutManager.isGestureActive(ctrlShift, "control_scale")).toBe(true);
    });
});
