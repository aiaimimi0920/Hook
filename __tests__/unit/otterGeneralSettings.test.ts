import { describe, expect, it } from "vitest";
import {
    applyOtterGeneralSettings,
    normalizeOtterGeneralSettings,
} from "../../src/services/otterGeneralSettings";

describe("Otter Loom-managed general settings", () => {
    it("normalizes the persisted theme, language, and close behavior", () => {
        expect(normalizeOtterGeneralSettings({
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
        expect(normalizeOtterGeneralSettings({ theme: "neon", language: "xx" })).toEqual({
            theme: "system",
            language: "zh-Hans",
            closeToTray: true,
        });
    });

    it("applies the selected locale and theme to the Otter document", () => {
        applyOtterGeneralSettings({ theme: "dark", language: "en", closeToTray: false });

        expect(document.documentElement.lang).toBe("en");
        expect(document.documentElement.dataset.otterTheme).toBe("dark");
        expect(document.documentElement.style.colorScheme).toBe("dark");
    });
});
