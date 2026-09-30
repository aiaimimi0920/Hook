import type { OcrTextSpan } from "../types/unit";

export interface OcrSpanBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface NormalizedOcrTextSpan {
    text: string;
    bounds: OcrSpanBounds;
    score: number;
}

export interface OcrOverlaySpanGeometry {
    characterSpans: NormalizedOcrTextSpan[];
    wordSpans: NormalizedOcrTextSpan[];
    textBounds: OcrSpanBounds;
}

const MAX_CHARACTER_SPANS = 256;
const MAX_WORD_SPANS = 64;
const MAX_SPAN_TEXT_LENGTH = 256;
const MAX_COORDINATE_MAGNITUDE = 1_000_000;

const normalizeSpanList = (
    value: unknown,
    limit: number,
    coordinateScale: number,
    lineBounds: OcrSpanBounds,
): NormalizedOcrTextSpan[] | null => {
    if (!Array.isArray(value) || value.length === 0 || value.length > limit) return null;
    const horizontal = lineBounds.maxX - lineBounds.minX >= lineBounds.maxY - lineBounds.minY;
    const normalized: NormalizedOcrTextSpan[] = [];
    let previousCenter = Number.NEGATIVE_INFINITY;
    for (const raw of value as OcrTextSpan[]) {
        if (
            raw?.source !== "ctcAlignedFromRecognitionTimesteps"
            || typeof raw.text !== "string"
            || raw.text.length === 0
            || raw.text.length > MAX_SPAN_TEXT_LENGTH
            || !Number.isFinite(raw.score)
            || raw.score < 0
            || raw.score > 1
            || !Array.isArray(raw.boxPoints)
            || raw.boxPoints.length !== 4
        ) return null;

        const points = raw.boxPoints.map((point) => ({
            x: point?.x / coordinateScale,
            y: point?.y / coordinateScale,
        }));
        if (points.some((point) =>
            !Number.isFinite(point.x)
            || !Number.isFinite(point.y)
            || Math.abs(point.x) > MAX_COORDINATE_MAGNITUDE
            || Math.abs(point.y) > MAX_COORDINATE_MAGNITUDE)) return null;

        const bounds = {
            minX: Math.max(lineBounds.minX, Math.min(...points.map((point) => point.x))),
            maxX: Math.min(lineBounds.maxX, Math.max(...points.map((point) => point.x))),
            minY: Math.max(lineBounds.minY, Math.min(...points.map((point) => point.y))),
            maxY: Math.min(lineBounds.maxY, Math.max(...points.map((point) => point.y))),
        };
        if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return null;
        const center = horizontal
            ? (bounds.minX + bounds.maxX) / 2
            : (bounds.minY + bounds.maxY) / 2;
        if (center + 0.01 < previousCenter) return null;
        previousCenter = center;
        normalized.push({ text: raw.text, bounds, score: raw.score });
    }
    return normalized;
};

const unionBounds = (spans: NormalizedOcrTextSpan[]): OcrSpanBounds => ({
    minX: Math.min(...spans.map((span) => span.bounds.minX)),
    maxX: Math.max(...spans.map((span) => span.bounds.maxX)),
    minY: Math.min(...spans.map((span) => span.bounds.minY)),
    maxY: Math.max(...spans.map((span) => span.bounds.maxY)),
});

/** Validates additive Loom span evidence before retaining it in the overlay model. */
export const resolveOcrOverlaySpanGeometry = (
    characterSpans: unknown,
    wordSpans: unknown,
    displayedText: string,
    lineBounds: OcrSpanBounds,
    coordinateScale = 1,
): OcrOverlaySpanGeometry | undefined => {
    if (!Number.isFinite(coordinateScale) || coordinateScale <= 0) return undefined;
    const characters = normalizeSpanList(
        characterSpans,
        MAX_CHARACTER_SPANS,
        coordinateScale,
        lineBounds,
    );
    const words = normalizeSpanList(wordSpans, MAX_WORD_SPANS, coordinateScale, lineBounds);
    const expected = displayedText.trim();
    const exactCharacters = characters?.map((span) => span.text).join("") === expected
        ? characters
        : null;
    const compactExpected = expected.replace(/\s/gu, "");
    const exactWords = words?.map((span) => span.text).join("").replace(/\s/gu, "") === compactExpected
        ? words
        : null;
    const evidence = exactCharacters ?? exactWords;
    if (!evidence?.length) return undefined;
    return {
        characterSpans: exactCharacters ?? [],
        wordSpans: exactWords ?? [],
        textBounds: unionBounds(evidence),
    };
};
