import { describe, expect, it } from "vitest";

import {
    createSerializedColorPickerStateQueue,
    normalizeDesktopColorPickerPayload,
} from "../../src/components/StickerDesktopColorPickerOverlay";

describe("normalizeDesktopColorPickerPayload", () => {
    it("keeps a valid native sample and falls back to finite global coordinates", () => {
        expect(normalizeDesktopColorPickerPayload({
            x: Number.NaN,
            y: Number.POSITIVE_INFINITY,
            globalX: 120,
            globalY: 240,
            hex: "#12aBcF",
            rgb: { r: 18, g: 171, b: 207 },
        })).toEqual({
            x: 120,
            y: 240,
            hex: "#12aBcF",
            rgb: { r: 18, g: 171, b: 207 },
        });
    });

    it.each([
        null,
        undefined,
        "#ff0000",
        123,
        { hex: "red", rgb: { r: 255, g: 0, b: 0 } },
        { hex: "#00ff00", rgb: { r: 255, g: 0, b: 0 } },
        { hex: "#ff0000", rgb: { r: -1, g: 0, b: 0 } },
        { hex: "#ff0000", rgb: { r: 255, g: 0.5, b: 0 } },
        { hex: "#ff0000", rgb: { r: 255, g: 0, b: 256 } },
    ])("rejects malformed cross-boundary color data", (payload) => {
        expect(normalizeDesktopColorPickerPayload(payload)).toBeNull();
    });

    it("serializes backend activation changes so the final requested state wins", async () => {
        const completions: Array<() => void> = [];
        const applied: boolean[] = [];
        const queue = createSerializedColorPickerStateQueue(
            (active) => new Promise<void>((resolve) => {
                applied.push(active);
                completions.push(resolve);
            }),
        );

        const activate = queue(true);
        const deactivate = queue(false);
        await Promise.resolve();
        expect(applied).toEqual([true]);
        completions.shift()?.();
        await activate;
        await Promise.resolve();
        expect(applied).toEqual([true, false]);
        completions.shift()?.();
        await deactivate;
    });
});
