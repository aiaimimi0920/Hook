import { describe, expect, it } from "vitest";

import {
    clipOcrBoundsToFrame,
    resolveOcrBlockBounds,
    resolveOcrBlockPresentation,
    resolveOcrImageFrame,
    resolveOcrOverlayColor,
    resolveOcrOverlayBlocks,
    resolveReadableOcrColor,
} from "../../src/components/UnitVisualOverlays";
import type { OcrBlock, Unit } from "../../src/types/unit";

const unitWithOcr = (width: number, height: number): Unit => ({
    id: "ocr-unit",
    type: "sticker",
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        ocrResult: { fullText: "", textBlocks: [], width, height },
    },
});

const ocrBlock = (text: string, x: number, y: number, width = 80, height = 20): OcrBlock => ({
    text,
    boxPoints: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
    ],
    boxScore: 1,
    textScore: 1,
    colorHex: "#ffffff",
    bgColorHex: "#000000",
});

describe("Unit visual OCR overlay validation", () => {
    it("rejects empty and non-finite OCR geometry", () => {
        expect(resolveOcrBlockBounds([])).toBeNull();
        expect(resolveOcrBlockBounds([{ x: Number.NaN, y: 2 }])).toBeNull();
        expect(resolveOcrBlockBounds([{ x: 1_000_001, y: 2 }])).toBeNull();
        expect(resolveOcrBlockBounds([{ x: 2, y: -1_000_001 }])).toBeNull();
        expect(resolveOcrImageFrame(unitWithOcr(0, 100), false)).toBeNull();
        expect(resolveOcrImageFrame(unitWithOcr(Number.POSITIVE_INFINITY, 100), false)).toBeNull();
        expect(resolveOcrBlockBounds(Array.from({ length: 33 }, (_, index) => ({ x: index, y: index })))).toBeNull();
    });

    it("computes finite bounds and contain-fit geometry", () => {
        expect(resolveOcrBlockBounds([{ x: 3, y: 7 }, { x: 13, y: 17 }])).toEqual({
            minX: 3,
            maxX: 13,
            minY: 7,
            maxY: 17,
        });
        expect(resolveOcrImageFrame(unitWithOcr(400, 100), false)).toEqual({
            left: 0,
            top: 25,
            width: 200,
            height: 50,
            scaleX: 0.5,
            scaleY: 0.5,
        });
        const frame = resolveOcrImageFrame(unitWithOcr(400, 100), false)!;
        const presentation = resolveOcrBlockPresentation(frame, {
            minX: 20,
            maxX: 220,
            minY: 10,
            maxY: 70,
        });
        expect(presentation.fontSize).toBeGreaterThan(10);
        expect(presentation.width).toBe(100);
        expect(presentation.height).toBe(30);
        expect(presentation.lineHeight).toBe(30);
        expect(presentation.fontSize).toBeCloseTo(22.8);

        const twoLinePresentation = resolveOcrBlockPresentation(frame, {
            minX: 20,
            maxX: 220,
            minY: 10,
            maxY: 70,
        }, 2);
        expect(twoLinePresentation.lineHeight).toBe(15);
        expect(twoLinePresentation.fontSize).toBeLessThan(presentation.fontSize);
    });

    it("clips OCR geometry to the visible source frame", () => {
        const frame = resolveOcrImageFrame(unitWithOcr(400, 100), false)!;
        expect(clipOcrBoundsToFrame(frame, {
            minX: -20,
            maxX: 440,
            minY: -10,
            maxY: 120,
        })).toEqual({ minX: 0, maxX: 400, minY: 0, maxY: 100 });
        expect(clipOcrBoundsToFrame(frame, {
            minX: 399,
            maxX: 410,
            minY: 99,
            maxY: 110,
        })).toEqual({ minX: 399, maxX: 400, minY: 99, maxY: 100 });
        expect(clipOcrBoundsToFrame(frame, {
            minX: 401,
            maxX: 410,
            minY: 20,
            maxY: 30,
        })).toBeNull();
    });

    it("preserves Loom's source-tagged baseline on a visual OCR row", () => {
        const block = ocrBlock("Ctrl+E", 10, 20, 100, 30);
        block.lineGeometry = {
            baseline: [{ x: 10, y: 44.6 }, { x: 110, y: 44.6 }],
            angleDegrees: 0,
            source: "estimatedFromRapidOcrLineQuad",
        };

        const visualLine = resolveOcrOverlayBlocks([block])[0]?.visualLines?.[0];

        expect(visualLine?.lineGeometry?.source).toBe("estimatedFromRapidOcrLineQuad");
        expect(visualLine?.lineGeometry?.baseline[0].y).toBeCloseTo(44.6);
    });

    it("preserves validated Loom character spans on an unchanged OCR row", () => {
        const block = ocrBlock("AB", 0, 0, 100, 30);
        block.characterSpans = [
            {
                text: "A",
                boxPoints: [{ x: 10, y: 2 }, { x: 30, y: 2 }, { x: 30, y: 28 }, { x: 10, y: 28 }],
                score: 0.98,
                source: "ctcAlignedFromRecognitionTimesteps",
            },
            {
                text: "B",
                boxPoints: [{ x: 34, y: 2 }, { x: 54, y: 2 }, { x: 54, y: 28 }, { x: 34, y: 28 }],
                score: 0.97,
                source: "ctcAlignedFromRecognitionTimesteps",
            },
        ];

        const line = resolveOcrOverlayBlocks([block])[0]?.visualLines?.[0];
        expect(line?.spanGeometry?.textBounds).toEqual({ minX: 10, maxX: 54, minY: 2, maxY: 28 });
        expect(resolveOcrOverlayBlocks([block], 1, () => "translated")[0]
            ?.visualLines?.[0]?.spanGeometry).toBeUndefined();
    });

    it("normalizes OCR coordinates reported in a higher-resolution OCR space", () => {
        const frame = resolveOcrImageFrame(unitWithOcr(400, 100), false)!;
        const nativeBounds = resolveOcrBlockBounds([{ x: 20, y: 10 }, { x: 220, y: 70 }]);
        const scaledBounds = resolveOcrBlockBounds(
            [{ x: 40, y: 20 }, { x: 440, y: 140 }],
            2,
        );
        expect(scaledBounds).toEqual(nativeBounds);
        expect(resolveOcrBlockPresentation(frame, scaledBounds!)).toEqual(
            resolveOcrBlockPresentation(frame, nativeBounds!),
        );
    });

    it("merges wrapped labels without merging neighbouring columns", () => {
        const merged = resolveOcrOverlayBlocks([
            ocrBlock("需要手机号的", 0, 0, 120, 30),
            ocrBlock("账号", 36, 28, 50, 32),
        ]);
        expect(merged).toHaveLength(1);
        expect(merged[0].text).toBe("需要手机号的\n账号");
        expect(merged[0].copyText).toBe("需要手机号的账号");
        expect(merged[0].bounds).toEqual({ minX: 0, maxX: 120, minY: 0, maxY: 60 });
        expect(merged[0].visualLines).toEqual([
            {
                text: "需要手机号的",
                bounds: { minX: 0, maxX: 120, minY: 0, maxY: 30 },
            },
            {
                text: "账号",
                bounds: { minX: 36, maxX: 86, minY: 28, maxY: 60 },
            },
        ]);

        const columns = resolveOcrOverlayBlocks([
            ocrBlock("左侧", 0, 0),
            ocrBlock("右侧", 140, 0),
        ]);
        expect(columns.map((block) => block.text)).toEqual(["左侧", "右侧"]);

        const interleavedColumns = resolveOcrOverlayBlocks([
            ocrBlock("左侧", 0, 0),
            ocrBlock("右侧", 140, 0),
            ocrBlock("名称", 20, 22, 60, 20),
            ocrBlock("名称", 160, 22, 60, 20),
        ]);
        expect(interleavedColumns.map((block) => block.text)).toEqual(["左侧\n名称", "右侧\n名称"]);
        expect(interleavedColumns.map((block) => block.copyText)).toEqual(["左侧名称", "右侧名称"]);
    });

    it("splits wide OCR rows before merging folder-name lines", () => {
        const folderRows = resolveOcrOverlayBlocks([
            ocrBlock("被删除的无限被删除的无限被删除的无限", 1, 100, 344, 31),
            ocrBlock("号-副本号副本(2)", 131, 122, 208, 32),
            ocrBlock("需要手机号的", 0, 254, 122, 35),
            ocrBlock("送出去的无限", 224, 255, 122, 31),
            ocrBlock("账号", 36, 278, 49, 32),
            ocrBlock("号", 271, 281, 30, 27),
            ocrBlock("待使用的无限正在使用的账", 2, 413, 230, 28),
            ocrBlock("号", 163, 439, 23, 22),
        ]);
        expect(folderRows.map((block) => block.text)).toEqual([
            "被删除的无限",
            "被删除的无限\n号-副本",
            "被删除的无限\n号副本(2)",
            "需要手机号的\n账号",
            "送出去的无限\n号",
            "待使用的无限",
            "正在使用的账\n号",
        ]);
        expect(folderRows.map((block) => block.copyText)).toEqual([
            "被删除的无限",
            "被删除的无限号-副本",
            "被删除的无限号副本(2)",
            "需要手机号的账号",
            "送出去的无限号",
            "待使用的无限",
            "正在使用的账号",
        ]);

        const mixedRows = resolveOcrOverlayBlocks([
            ocrBlock("1.说明", 0, 0, 80, 24),
            ocrBlock("2.说明", 0, 35, 80, 24),
            ocrBlock("被删除的无限被删除的无限被删除的无限", 1, 100, 344, 31),
            ocrBlock("号-副本号副本(2)", 131, 122, 208, 32),
            ocrBlock("需要手机号的", 0, 254, 122, 35),
            ocrBlock("送出去的无限", 224, 255, 122, 31),
            ocrBlock("账号", 36, 278, 49, 32),
            ocrBlock("号", 271, 281, 30, 27),
            ocrBlock("待使用的无限正在使用的账", 2, 413, 230, 28),
            ocrBlock("号", 163, 439, 23, 22),
        ]);
        expect(mixedRows.filter((block) => block.text.startsWith("被删除的无限"))).toHaveLength(3);
    });

    it("does not infer label columns across unrelated document rows", () => {
        const rows = resolveOcrOverlayBlocks([
            ocrBlock("#七、当前仍需人工观察的部分", 7, 26, 310, 25),
            ocrBlock("Hook EXE  测试：", 159, 75, 172, 30),
            ocrBlock("建议你重点用新", 8, 78, 158, 24),
            ocrBlock("1.很小的 OCR 原始文字；", 6, 126, 258, 32),
            ocrBlock("截图顶部第一行；", 38, 153, 172, 29),
            ocrBlock("2.", 11, 161, 21, 17),
            ocrBlock("截图最下方一行；", 40, 181, 165, 26),
            ocrBlock("3.", 11, 185, 19, 18),
        ]);

        const titleRows = rows.filter((row) => row.bounds.minY < 60);
        expect(titleRows).toHaveLength(1);
        expect(titleRows[0].text).toBe("#七、当前仍需人工观察的部分");

        const fullWidthMarkerRows = resolveOcrOverlayBlocks([
            ocrBlock("１．全角编号标题", 0, 0, 300, 24),
            ocrBlock("甲", 18, 80, 40, 24),
            ocrBlock("乙", 93, 80, 40, 24),
            ocrBlock("丙", 168, 80, 40, 24),
            ocrBlock("丁", 243, 80, 40, 24),
        ]);
        expect(fullWidthMarkerRows.some((row) => row.text === "１．全角编号标题")).toBe(true);
    });

    it("deduplicates text repeated by overlapping detector fragments", () => {
        const [row] = resolveOcrOverlayBlocks([
            ocrBlock("9. Ctrl+2", 8, 340, 106, 22),
            ocrBlock("2重新识别后，再用", 101, 336, 196, 28),
            ocrBlock("用Alt+2显示；", 286, 333, 145, 34),
        ]);
        expect(row.text).toBe("9. Ctrl+2重新识别后，再用Alt+2显示；");

        const [punctuationRow] = resolveOcrOverlayBlocks([
            ocrBlock("5.", 11, 238, 19, 17),
            ocrBlock("．含 #、--、引号和空格的文本；", 24, 232, 326, 28),
        ]);
        expect(punctuationRow.text).toBe("5.含 #、--、引号和空格的文本；");

        const [emojiRow] = resolveOcrOverlayBlocks([
            ocrBlock("图😀", 0, 0, 50, 24),
            ocrBlock("😀像", 42, 0, 50, 24),
        ]);
        expect(emojiRow.text).toBe("图😀像");

        const [compatibilityRow] = resolveOcrOverlayBlocks([
            ocrBlock("oﬃ", 0, 0, 50, 24),
            ocrBlock("ffiice", 42, 0, 70, 24),
        ]);
        expect(compatibilityRow.text).toBe("oﬃ ffiice");
    });

    it("keeps overlapping detector rows separate while joining same-row fragments", () => {
        const rows = resolveOcrOverlayBlocks([
            ocrBlock("1.使用 Ctrl+1 截取一个贴图;", 0, 59, 321, 45),
            ocrBlock("使用（", 34, 91, 66, 30),
            ocrBlock("Ctr1+2执行OCR；", 82, 85, 198, 40),
            ocrBlock("2.", 3, 95, 27, 23),
        ]);

        expect(rows).toHaveLength(2);
        expect(rows[0].text).toBe("1.使用 Ctrl+1 截取一个贴图;");
        expect(rows[1].text).toContain("Ctr1+2执行OCR；");
        expect(rows[1].text).not.toContain("\n");
        // Detector boxes may retain a small safety overlap so descenders are
        // not clipped; the layout pass must nevertheless keep it bounded.
        expect(rows[0].bounds.maxY - rows[1].bounds.minY).toBeLessThan(10);
    });

    it("retains every adjacent OCR row when detector boxes overlap", () => {
        const rows = resolveOcrOverlayBlocks([
            ocrBlock("1.关闭当前正在运行的旧 Hook;", 14, 11, 328, 34),
            ocrBlock("2.启动hook-ocr-layout-fix-20260827-v2.exe;", 13, 38, 494, 33),
            ocrBlock("3.使用Ctr1+1截取你刚才提供的原始测试图片；", 13, 63, 494, 33),
            ocrBlock("4.使用Ctr1+2执行OCR；", 9, 85, 284, 42),
        ]);

        expect(rows.map((row) => row.text)).toEqual([
            "1.关闭当前正在运行的旧 Hook;",
            "2.启动hook-ocr-layout-fix-20260827-v2.exe;",
            "3.使用Ctr1+1截取你刚才提供的原始测试图片；",
            "4.使用Ctr1+2执行OCR；",
        ]);
        expect(rows.every((row) => row.bounds.maxY > row.bounds.minY)).toBe(true);
    });

    it("preserves indented list rows as separate non-overlapping targets", () => {
        const rows = resolveOcrOverlayBlocks([
            ocrBlock("10. 多次点击“复制全文”:", 0, 0, 310, 32),
            ocrBlock("- 每次都应复制;", 32, 25, 260, 30),
            ocrBlock("- 每次都应显示全文复制通知。", 32, 50, 280, 30),
        ]);

        expect(rows.map((row) => row.text)).toEqual([
            "10. 多次点击“复制全文”:",
            "- 每次都应复制;",
            "- 每次都应显示全文复制通知。",
        ]);
        expect(rows.every((row) => !row.text.includes("\n"))).toBe(true);
        for (let index = 0; index + 1 < rows.length; index += 1) {
            expect(rows[index].bounds.maxY).toBeLessThanOrEqual(rows[index + 1].bounds.minY);
        }
    });

    it("reconstructs adjacent prose rows without vertical collisions", () => {
        const rows = resolveOcrOverlayBlocks([
            ocrBlock("应直接复制当前缓存全文，不应出现重新识别等待。", 0, 0, 450, 34),
            ocrBlock("切换到翻译显示状态后再次点击复制全文。", 0, 27, 430, 34),
            ocrBlock("应复制当前显示的翻译文本。", 0, 54, 320, 34),
        ]);

        expect(rows).toHaveLength(3);
        expect(rows.every((row) => !row.text.includes("\n"))).toBe(true);
        for (let index = 0; index + 1 < rows.length; index += 1) {
            expect(rows[index].bounds.maxY).toBeLessThanOrEqual(rows[index + 1].bounds.minY);
        }
    });

    it("normalizes regular single-line frames to one shared baseline rhythm", () => {
        const rows = resolveOcrOverlayBlocks([
            ocrBlock("第一行", 0, 0, 120, 40),
            ocrBlock("第二行", 0, 55, 120, 40),
            ocrBlock("第三行", 0, 110, 120, 40),
        ]);
        expect(rows).toHaveLength(3);
        const hints = rows.map((row) => row.lineHeightHint);
        expect(new Set(hints).size).toBe(1);
        const hint = hints[0]!;
        expect(rows.every((row) => row.bounds.maxY - row.bounds.minY === hint)).toBe(true);
        expect(rows.map((row) => row.visualLines?.[0]?.bounds)).toEqual(
            rows.map((row) => row.bounds),
        );
    });

    it("accepts only six- or eight-digit hex colors", () => {
        expect(resolveOcrOverlayColor("#12aBcF", "#ffffff")).toBe("#12aBcF");
        expect(resolveOcrOverlayColor("#12abcdef", "#ffffff")).toBe("#12abcdef");
        expect(resolveOcrOverlayColor("url(javascript:bad)", "#ffffff")).toBe("#ffffff");
    });

    it("keeps OCR text readable on the opaque shared fill", () => {
        expect(resolveReadableOcrColor("#ffffff", "#101010")).toBe("#ffffff");
        expect(resolveReadableOcrColor("#777777", "#808080")).toBe("#000000");
        expect(resolveReadableOcrColor("invalid", "#808080")).toBe("invalid");
    });
});
