// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { ShortcutManager } from "../../src/platform/desktop/shortcuts";
import {
    cycleUnitChromeMode, hideCollapsedUnitEndpoints, isCleanView, setIsCleanView,
    setUnitChromeMode, unitChromeMode, unitEndpointsVisible,
} from "../../src/features/workspace/state/unitChromeState";

afterEach(() => { setUnitChromeMode("all"); ShortcutManager.resetToDefaults(); });

describe("global sticker chrome", () => {
    it("advances once per shortcut press, ignoring keyboard auto-repeat", () => {
        ShortcutManager.resetToDefaults();
        ShortcutManager.register("toggle-clean-view", cycleUnitChromeMode);
        const press = (repeat = false) => ShortcutManager.handleKeyDown(new KeyboardEvent("keydown", {
            key: "$", code: "Digit4", ctrlKey: true, shiftKey: true, repeat,
        }));
        expect(press()).toBe(true);
        expect(unitChromeMode()).toBe("border");
        expect(press(true)).toBe(true);
        expect(unitChromeMode()).toBe("border");
        press(); expect(unitChromeMode()).toBe("none");
        press(); expect(unitChromeMode()).toBe("all");
    });
    it("cycles all, border only, hidden, then all without losing per-unit preferences", () => {
        for (const mode of ["all", "border", "none", "all"]) {
            expect(unitChromeMode()).toBe(mode);
            expect(isCleanView()).toBe(mode === "none");
            expect(hideCollapsedUnitEndpoints()).toBe(mode !== "all");
            expect(unitEndpointsVisible(false)).toBe(mode === "all");
            expect(unitEndpointsVisible(false, true)).toBe(false);
            expect(unitEndpointsVisible(true, true)).toBe(true);
            expect(unitEndpointsVisible(true, false)).toBe(true);
            cycleUnitChromeMode();
        }
    });

    it("preserves the existing boolean clean-view reset API", () => {
        setIsCleanView(true);
        expect(unitChromeMode()).toBe("none");
        setIsCleanView((previous) => !previous);
        expect(unitChromeMode()).toBe("all");
    });
});
