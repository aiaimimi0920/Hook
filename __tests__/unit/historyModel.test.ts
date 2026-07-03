import { describe, expect, it } from "vitest";

import {
    MAX_COLOR_HISTORY,
    MAX_SCREENSHOT_HISTORY,
    addColorToHistory,
    addScreenshotToHistory,
    removeScreenshotFromHistory,
    sanitizeHistoryState,
    type ColorHistoryEntry,
    type ScreenshotHistoryEntry,
} from "../../src/services/historyModel";

const color = (hex: string): { hex: string; rgb: { r: number; g: number; b: number } } => ({
    hex,
    rgb: { r: 1, g: 2, b: 3 },
});

const screenshot = (id: string): ScreenshotHistoryEntry => ({
    id,
    thumbnail: "data:image/png;base64,AAAA",
    width: 10,
    height: 10,
    at: 0,
});

describe("color history", () => {
    it("prepends the newest color to the front", () => {
        let history: ColorHistoryEntry[] = [];
        history = addColorToHistory(history, color("#ff0000"), 1);
        history = addColorToHistory(history, color("#00ff00"), 2);
        expect(history.map((entry) => entry.hex)).toEqual(["#00ff00", "#ff0000"]);
    });

    it("de-duplicates by hex and moves the repeat to the front with a fresh timestamp", () => {
        let history: ColorHistoryEntry[] = [];
        history = addColorToHistory(history, color("#ff0000"), 1);
        history = addColorToHistory(history, color("#00ff00"), 2);
        history = addColorToHistory(history, color("#ff0000"), 5);
        expect(history.map((entry) => entry.hex)).toEqual(["#ff0000", "#00ff00"]);
        expect(history[0].at).toBe(5);
        expect(history).toHaveLength(2);
    });

    it("normalizes hex casing and a missing leading hash", () => {
        const history = addColorToHistory([], color("AABBCC"), 1);
        expect(history[0].hex).toBe("#aabbcc");
    });

    it("ignores malformed hex values", () => {
        const history = addColorToHistory([], color("not-a-color"), 1);
        expect(history).toHaveLength(0);
    });

    it("caps the list at the configured limit", () => {
        let history: ColorHistoryEntry[] = [];
        for (let index = 0; index < MAX_COLOR_HISTORY + 10; index += 1) {
            const hex = `#${index.toString(16).padStart(6, "0")}`;
            history = addColorToHistory(history, color(hex), index);
        }
        expect(history).toHaveLength(MAX_COLOR_HISTORY);
    });
});

describe("screenshot history", () => {
    it("prepends newest and caps the list", () => {
        let history: ScreenshotHistoryEntry[] = [];
        for (let index = 0; index < MAX_SCREENSHOT_HISTORY + 5; index += 1) {
            history = addScreenshotToHistory(history, screenshot(`s-${index}`));
        }
        expect(history).toHaveLength(MAX_SCREENSHOT_HISTORY);
        expect(history[0].id).toBe(`s-${MAX_SCREENSHOT_HISTORY + 4}`);
    });

    it("removes an entry by id", () => {
        let history = [screenshot("a"), screenshot("b"), screenshot("c")];
        history = removeScreenshotFromHistory(history, "b");
        expect(history.map((entry) => entry.id)).toEqual(["a", "c"]);
    });
});

describe("sanitizeHistoryState", () => {
    it("returns an empty state for non-object input", () => {
        expect(sanitizeHistoryState(null)).toEqual({ colors: [], screenshots: [] });
        expect(sanitizeHistoryState("nope")).toEqual({ colors: [], screenshots: [] });
    });

    it("drops malformed color and screenshot entries", () => {
        const state = sanitizeHistoryState({
            colors: [
                { hex: "#ff0000", rgb: { r: 255, g: 0, b: 0 }, at: 5 },
                { hex: "bad" },
                { rgb: { r: 1, g: 2, b: 3 } },
            ],
            screenshots: [
                { id: "ok", thumbnail: "data:image/png;base64,AAAA", width: 1, height: 1, at: 2 },
                { id: "no-thumb" },
                { thumbnail: "data:image/png;base64,BBBB" },
                { id: "bad-thumb", thumbnail: "http://example.com/x.png" },
            ],
        });
        expect(state.colors).toHaveLength(1);
        expect(state.colors[0].hex).toBe("#ff0000");
        expect(state.screenshots).toHaveLength(1);
        expect(state.screenshots[0].id).toBe("ok");
    });
});
