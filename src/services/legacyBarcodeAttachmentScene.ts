// Builds the one-time compatibility scene for pre-capability barcode sessions.
import type { BarcodeResult, BarcodeScanResult } from "../types/unit";

const COPY_CODE_COMMAND = "neuro.official/ocr.copy-code";
const MAX_ATTACHMENT_BYTES = 240 * 1024;
const MAX_RESULTS = 32;

const boundedString = (value: unknown, maximum: number): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= maximum;

const finitePoint = (value: unknown): value is { x: number; y: number } => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const point = value as Record<string, unknown>;
    return typeof point.x === "number" && Number.isFinite(point.x)
        && typeof point.y === "number" && Number.isFinite(point.y);
};

const validResult = (value: unknown): value is BarcodeResult => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const result = value as Record<string, unknown>;
    const points = result.points;
    const bounds = result.bounds;
    const validBounds = bounds == null || (
        typeof bounds === "object"
        && !Array.isArray(bounds)
        && ["left", "top", "right", "bottom"].every((key) => {
            const coordinate = (bounds as Record<string, unknown>)[key];
            return typeof coordinate === "number" && Number.isFinite(coordinate);
        })
    );
    return boundedString(result.id, 64)
        && boundedString(result.format, 64)
        && boundedString(result.text, 16_384)
        && (result.url == null || boundedString(result.url, 16_384))
        && Array.isArray(points)
        && points.length <= 16
        && points.every(finitePoint)
        && validBounds;
};

const percent = (value: number, maximum: number) =>
    `${Math.min(Math.max(value / Math.max(maximum, 1) * 100, 0), 100).toFixed(5)}%`;

const markerBounds = (result: BarcodeResult, index: number, width: number, height: number) => {
    const bounds = result.bounds;
    if (bounds && bounds.right > bounds.left && bounds.bottom > bounds.top) {
        return {
            left: Math.min(Math.max(bounds.left, 0), width),
            top: Math.min(Math.max(bounds.top, 0), height),
            right: Math.min(Math.max(bounds.right, 0), width),
            bottom: Math.min(Math.max(bounds.bottom, 0), height),
        };
    }
    const top = Math.min(8 + index * 22, Math.max(height - 18, 0));
    return { left: 8, top, right: 26, bottom: top + 18 };
};

const scene = (results: BarcodeResult[], width: number, height: number) => ({
    id: "ocr-code-overlay-root",
    type: "stack",
    props: { visible: true },
    layout: { position: "relative", width: "100%", height: "100%", overflowX: "hidden", overflowY: "hidden" },
    children: results.map((result, index) => {
        const bounds = markerBounds(result, index, width, height);
        return {
            id: `ocr-code-${index}`,
            type: "stack",
            props: { eventPayload: { text: result.text, format: result.format, resultId: result.id } },
            layout: {
                position: "absolute",
                left: percent(bounds.left, width),
                top: percent(bounds.top, height),
                width: percent(Math.max(bounds.right - bounds.left, 18), width),
                height: percent(Math.max(bounds.bottom - bounds.top, 18), height),
            },
            style: { borderColor: "#22c55e", borderWidth: "1px" },
            accessibility: {
                label: `复制第 ${index + 1} 个二维码或条码内容`,
                description: `${result.format}，点击复制`,
            },
            events: { click: COPY_CODE_COMMAND },
            children: [{
                id: `ocr-code-label-${index}`,
                type: "text",
                props: { text: String(index + 1) },
                layout: { position: "absolute", left: "0px", top: "0px", minWidth: "18px", height: "18px", padding: "2px" },
                style: { background: "#22c55e", color: "#08110b", fontSize: "10px", lineHeight: "14px", fontWeight: 800, textAlign: "center" },
            }],
        };
    }),
});

export const buildLegacyBarcodeAttachmentPayload = (
    value: BarcodeScanResult,
): Record<string, unknown> | null => {
    if (!Number.isSafeInteger(value.width) || value.width < 1 || value.width > 100_000
        || !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 100_000
        || !Array.isArray(value.results) || value.results.length > MAX_RESULTS
        || !value.results.every(validResult)) return null;
    const resultIds = new Set(value.results.map((result) => result.id));
    if (resultIds.size !== value.results.length
        || (value.selectedId !== undefined && !resultIds.has(value.selectedId))) return null;
    const payload = {
        schemaVersion: "1",
        visible: true,
        sourceWidth: value.width,
        sourceHeight: value.height,
        ...(value.selectedId ? { selectedId: value.selectedId } : {}),
        results: value.results,
        surfaceScene: scene(value.results, value.width, value.height),
        migration: { source: "hook.unitData.barcodeResult", version: 1 },
    };
    return new TextEncoder().encode(JSON.stringify(payload)).byteLength <= MAX_ATTACHMENT_BYTES
        ? payload
        : null;
};
