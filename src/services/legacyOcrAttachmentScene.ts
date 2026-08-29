// Builds the generic attachment payload used only while importing pre-plugin OCR sessions.
import type { OcrBlock, UnitData } from "../types/unit";
import { resolveOcrOverlayFillColor } from "./ocrOverlayFillColor";
import {
    resolveOcrBlockBounds,
    resolveOcrOverlayBlocks,
    resolveOcrOverlayVisualLines,
} from "./ocrOverlayLayout";
import { validateExtensionJsonValue } from "./unitExtensionValidation";

type LegacyOcrResult = NonNullable<UnitData["ocrResult"]>;

const MAX_SOURCE_DIMENSION = 100_000;
const MAX_LEGACY_BLOCKS = 512;
const MAX_CLICKABLE_SCENE_BLOCKS = 255;
const MAX_TEXT_BYTES = 96 * 1024;
const MAX_BLOCK_TEXT_BYTES = 1024;
const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength;
const safeColor = (value: unknown, fallback: string): string =>
    typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;
const positiveFinite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
const unitScore = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const boundedOptionalText = (value: unknown): boolean =>
    value === undefined || (typeof value === "string" && utf8Length(value) <= MAX_BLOCK_TEXT_BYTES);
const validPoint = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const point = value as Record<string, unknown>;
    return Number.isFinite(point.x) && Number.isFinite(point.y);
};
const validSpan = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const span = value as Record<string, unknown>;
    return typeof span.text === "string"
        && utf8Length(span.text) <= MAX_BLOCK_TEXT_BYTES
        && Array.isArray(span.boxPoints)
        && span.boxPoints.length === 4
        && span.boxPoints.every(validPoint)
        && unitScore(span.score)
        && span.source === "ctcAlignedFromRecognitionTimesteps";
};

const preservesWithinSchema = (block: OcrBlock): boolean => {
    if (
        typeof block.text !== "string"
        || block.text.trim().length === 0
        || utf8Length(block.text) > MAX_BLOCK_TEXT_BYTES
        || !Array.isArray(block.boxPoints)
        || block.boxPoints.length === 0
        || block.boxPoints.length > 32
        || !block.boxPoints.every(validPoint)
        || !unitScore(block.boxScore)
        || !unitScore(block.textScore)
        || !HEX_COLOR.test(block.colorHex)
        || !HEX_COLOR.test(block.bgColorHex)
        || !boundedOptionalText(block.rawText)
        || !boundedOptionalText(block.translatedText)
    ) return false;
    const spans = [block.characterSpans, block.wordSpans];
    if (spans.some((items) => items !== undefined
        && (!Array.isArray(items) || items.length > 2048 || !items.every(validSpan)))) return false;
    const line = block.lineGeometry;
    return line === undefined || (
        Array.isArray(line.baseline)
        && line.baseline.length === 2
        && line.baseline.every(validPoint)
        && Number.isFinite(line.angleDegrees)
        && line.source === "estimatedFromRapidOcrLineQuad"
    );
};

const inferDimension = (
    blocks: readonly OcrBlock[],
    axis: "x" | "y",
    coordinateScale: number,
): number => {
    let maximum = 1;
    for (const block of blocks) {
        if (!Array.isArray(block.boxPoints)) continue;
        for (const point of block.boxPoints) {
            const coordinate = point?.[axis];
            if (Number.isFinite(coordinate)) maximum = Math.max(maximum, coordinate / coordinateScale);
        }
    }
    return Math.ceil(maximum);
};

const sourceDimension = (
    value: unknown,
    blocks: readonly OcrBlock[],
    axis: "x" | "y",
    coordinateScale: number,
): number | null => {
    const dimension = positiveFinite(value) ? Math.ceil(value) : inferDimension(blocks, axis, coordinateScale);
    return dimension <= MAX_SOURCE_DIMENSION ? dimension : null;
};

const percent = (value: number, maximum: number): string =>
    `${Math.max(0, Math.min(100, value / maximum * 100)).toFixed(5)}%`;

const preserveBlock = (
    block: OcrBlock,
    coordinateScale: number,
    sourceWidth: number,
    sourceHeight: number,
    fillColor: string,
): Record<string, unknown> | null => {
    if (!preservesWithinSchema(block)) return null;
    const bounds = resolveOcrBlockBounds(block.boxPoints, coordinateScale);
    if (!bounds) return null;
    const left = Math.max(0, Math.min(sourceWidth, bounds.minX));
    const top = Math.max(0, Math.min(sourceHeight, bounds.minY));
    const right = Math.max(0, Math.min(sourceWidth, bounds.maxX));
    const bottom = Math.max(0, Math.min(sourceHeight, bounds.maxY));
    if (right <= left || bottom <= top) return null;
    return {
        text: block.text,
        left,
        top,
        width: right - left,
        height: bottom - top,
        textColor: safeColor(block.colorHex, "#f8fafc"),
        backgroundColor: fillColor,
        boxPoints: block.boxPoints,
        boxScore: block.boxScore,
        textScore: block.textScore,
        colorHex: block.colorHex,
        bgColorHex: block.bgColorHex,
        ...(block.rawText === undefined ? {} : { rawText: block.rawText }),
        ...(block.lineGeometry === undefined ? {} : { lineGeometry: block.lineGeometry }),
        ...(block.characterSpans === undefined ? {} : { characterSpans: block.characterSpans }),
        ...(block.wordSpans === undefined ? {} : { wordSpans: block.wordSpans }),
        ...(block.translatedText === undefined ? {} : { translatedText: block.translatedText }),
        ...(block.translating === undefined ? {} : { translating: block.translating }),
    };
};

const buildSurfaceScene = (
    blocks: OcrBlock[],
    coordinateScale: number,
    sourceWidth: number,
    sourceHeight: number,
    fillColor: string,
): Record<string, unknown> | null => {
    const overlays = resolveOcrOverlayBlocks(blocks, coordinateScale);
    if (overlays.length > MAX_CLICKABLE_SCENE_BLOCKS) return null;
    const children = overlays.map((block, index) => {
        const lines = resolveOcrOverlayVisualLines(block);
        const lineHeight = (block.bounds.maxY - block.bounds.minY) / Math.max(1, lines.length);
        const fontSize = Math.max(0.2, Math.min(100, lineHeight / sourceHeight * 76));
        const cssLineHeight = Math.max(0.2, Math.min(100, lineHeight / sourceHeight * 100));
        return {
            id: `ocr-block-${index}`,
            type: "stack",
            props: { eventPayload: { text: block.copyText } },
            layout: {
                position: "absolute",
                left: percent(block.bounds.minX, sourceWidth),
                top: percent(block.bounds.minY, sourceHeight),
                width: percent(block.bounds.maxX - block.bounds.minX, sourceWidth),
                height: percent(block.bounds.maxY - block.bounds.minY, sourceHeight),
                overflowX: "hidden",
                overflowY: "hidden",
            },
            style: { background: fillColor },
            events: { click: "neuro.official/ocr.copy-block" },
            children: [{
                id: `ocr-text-${index}`,
                type: "text",
                props: { text: block.text },
                layout: { width: "100%", height: "100%" },
                style: {
                    color: safeColor(block.colorHex, "#f8fafc"),
                    fontSize: `${fontSize.toFixed(4)}cqh`,
                    lineHeight: `${cssLineHeight.toFixed(4)}cqh`,
                    whiteSpace: lines.length > 1 ? "pre" : "nowrap",
                },
            }],
        };
    });
    return {
        id: "ocr-overlay-root",
        type: "stack",
        props: { visible: true },
        layout: {
            position: "relative",
            width: "100%",
            height: "100%",
            overflowX: "hidden",
            overflowY: "hidden",
        },
        children,
    };
};

/** Returns null instead of truncating persisted user text or geometry. */
export const buildLegacyOcrAttachmentPayload = (result: LegacyOcrResult): unknown | null => {
    if (typeof result.fullText !== "string" || utf8Length(result.fullText) > MAX_TEXT_BYTES) return null;
    if (!Array.isArray(result.textBlocks) || result.textBlocks.length > MAX_LEGACY_BLOCKS) return null;
    const coordinateScale = positiveFinite(result.scaleFactor) ? result.scaleFactor : 1;
    if (coordinateScale > 1000) return null;
    const sourceWidth = sourceDimension(result.width, result.textBlocks, "x", coordinateScale);
    const sourceHeight = sourceDimension(result.height, result.textBlocks, "y", coordinateScale);
    if (!sourceWidth || !sourceHeight) return null;
    const fillColor = resolveOcrOverlayFillColor(result.textBlocks).hex;
    const textBlocks = result.textBlocks.map((block) =>
        preserveBlock(block, coordinateScale, sourceWidth, sourceHeight, fillColor));
    if (textBlocks.some((block) => block === null)) return null;
    const surfaceScene = buildSurfaceScene(
        result.textBlocks,
        coordinateScale,
        sourceWidth,
        sourceHeight,
        fillColor,
    );
    if (!surfaceScene) return null;
    try {
        return validateExtensionJsonValue({
            schemaVersion: "1",
            visible: true,
            showTranslated: false,
            sourceWidth,
            sourceHeight,
            coordinateScale,
            fullText: result.fullText,
            textBlocks,
            surfaceScene,
            migration: { source: "hook.unitData.ocrResult", version: 1 },
        });
    } catch {
        return null;
    }
};
