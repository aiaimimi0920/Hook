import { describe, expect, it } from "vitest";
import { ShortcutManager } from "../../src/services/shortcuts";

describe("ShortcutManager legacy Hook shortcuts", () => {
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
});
