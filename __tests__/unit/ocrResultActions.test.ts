import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../src/services/api";
import {
    copyCachedOcrFullText,
    resolveCachedOcrFullText,
} from "../../src/services/ocrResultActions";
import { graphStore } from "../../src/store/graphStore";
import { enhancementNotices, uiActions } from "../../src/store/uiStore";
import type { OcrBlock, Unit } from "../../src/types/unit";

const UNIT_ID = "cached-ocr-full-text";

const block = (text: string, translatedText: string, left: number): OcrBlock => ({
    text,
    translatedText,
    boxPoints: [
        { x: left, y: 10 },
        { x: left + 40, y: 10 },
        { x: left + 40, y: 30 },
        { x: left, y: 30 },
    ],
    boxScore: 1,
    textScore: 1,
    colorHex: "#ffffff",
    bgColorHex: "#000000",
});

const createUnit = (showTranslated = false): Unit => ({
    id: UNIT_ID,
    type: "sticker",
    x: 0,
    y: 0,
    w: 300,
    h: 100,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        showTranslated,
        ocrResult: {
            fullText: "first\nsecond",
            width: 300,
            height: 100,
            textBlocks: [block("first", "第一", 10), block("second", "第二", 180)],
        },
    },
});

describe("cached OCR full-text actions", () => {
    afterEach(() => {
        graphStore.actions.replaceUnits([]);
        uiActions.dismissEnhancementNotice(UNIT_ID);
        vi.restoreAllMocks();
    });

    it("uses canonical fullText in original mode and displayed blocks in translated mode", () => {
        expect(resolveCachedOcrFullText(createUnit())).toBe("first\nsecond");
        expect(resolveCachedOcrFullText(createUnit(true))).toBe("第一\n第二");
        expect(resolveCachedOcrFullText(undefined)).toBe("");
    });

    it("copies cached translated text without invoking OCR again", async () => {
        graphStore.actions.replaceUnits([createUnit(true)]);
        const copyText = vi.spyOn(api, "copyTextToClipboard").mockResolvedValue(true);
        const performOcr = vi.spyOn(api, "performOcr");

        await expect(copyCachedOcrFullText(UNIT_ID)).resolves.toBe(true);

        expect(copyText).toHaveBeenCalledWith("第一\n第二");
        expect(performOcr).not.toHaveBeenCalled();
        expect(enhancementNotices[UNIT_ID]?.[0]?.title).toBe("全部 OCR 文本已复制");
        expect(enhancementNotices[UNIT_ID]?.[0]?.message).toContain("已复制全文");
    });
});
