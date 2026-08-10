import { describe, expect, it } from "vitest";
import {
    applyHookGeneralSettings,
    normalizeHookGeneralSettings,
} from "../../src/services/hookGeneralSettings";

describe("Hook Loom-managed general settings", () => {
    it("normalizes the persisted theme, language, and close behavior", () => {
        expect(normalizeHookGeneralSettings({
            theme: "light",
            language: "en",
            close_to_tray: false,
        })).toEqual({
            theme: "light",
            language: "en",
            closeToTray: false,
        });
    });

    it("uses safe defaults for missing or invalid settings", () => {
        expect(normalizeHookGeneralSettings({ theme: "neon", language: "xx" })).toEqual({
            theme: "system",
            language: "zh-Hans",
            closeToTray: true,
        });
    });

    it("applies the selected locale and theme to the Hook document", () => {
        applyHookGeneralSettings({ theme: "dark", language: "en", closeToTray: false });

        expect(document.documentElement.lang).toBe("en");
        expect(document.documentElement.dataset.hookTheme).toBe("dark");
        expect(document.documentElement.style.colorScheme).toBe("dark");
    });
});
