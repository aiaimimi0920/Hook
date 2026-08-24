import { afterEach, describe, expect, it, vi } from "vitest";

describe("sticker text geometry", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it("reuses one detached canvas context across text measurements", async () => {
        const context = {
            font: "",
            measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
        };
        const getContext = vi.fn(() => context);
        const createElement = vi.fn(() => ({ getContext }));
        vi.stubGlobal("document", { createElement });

        const { measureTextWidth } = await import("../../src/services/stickerTextGeometry");

        expect(measureTextWidth("one", 20)).toBe(30);
        expect(measureTextWidth("three", 20)).toBe(50);
        expect(createElement).toHaveBeenCalledTimes(1);
        expect(getContext).toHaveBeenCalledTimes(1);
        expect(context.measureText).toHaveBeenCalledTimes(2);
    });
});
