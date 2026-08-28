import type { OcrBlock, OcrLineGeometry, Unit } from "../types/unit";
import {
    normalizeOcrLineGeometry,
    remapOcrLineGeometry,
} from "./ocrOverlayBaseline";
import { normalizeOcrRowGeometry } from "./ocrOverlayRowGeometry";
import {
    resolveOcrOverlaySpanGeometry,
    type OcrOverlaySpanGeometry,
} from "./ocrOverlaySpanGeometry";
import {
    splitAbnormallyWideOcrBlocks,
    startsOcrListLine,
} from "./ocrOverlayColumnSplit";

export interface OcrImageFrame {
    left: number;
    top: number;
    width: number;
    height: number;
    scaleX: number;
    scaleY: number;
}

export interface OcrBlockBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface OcrOverlayVisualLine {
    text: string;
    bounds: OcrBlockBounds;
    lineHeightHint?: number;
    lineGeometry?: OcrLineGeometry;
    spanGeometry?: OcrOverlaySpanGeometry;
}

export interface OcrBlockPresentation {
    left: number;
    top: number;
    width: number;
    height: number;
    fontSize: number;
    lineHeight: number;
    paddingX: number;
}

export interface OcrOverlayBlock {
    /** Text shown in the overlay, preserving visual line breaks. */
    text: string;
    /** Text copied for this semantic target, with wrapped lines joined. */
    copyText: string;
    bounds: OcrBlockBounds;
    colorHex: string;
    bgColorHex: string;
    /** Internal marker preventing a synthetic column split from being rejoined. */
    splitColumn?: boolean;
    /** Estimated distance between adjacent OCR baselines in source pixels. */
    lineHeightHint?: number;
    /** Original row geometry retained when several rows form one copy target. */
    visualLines?: OcrOverlayVisualLine[];
}

/** Returns render rows while preserving compatibility with synthetic test blocks. */
export const resolveOcrOverlayVisualLines = (block: OcrOverlayBlock): OcrOverlayVisualLine[] =>
    block.visualLines?.length
        ? block.visualLines
        : [{ text: block.text, bounds: block.bounds, lineHeightHint: block.lineHeightHint }];

export const MAX_OCR_BLOCKS = 512;
const MAX_OCR_POINTS = 32;
const MAX_OCR_COORDINATE_MAGNITUDE = 1_000_000;
const MAX_OCR_LINES = 128;
const MAX_OCR_OVERLAY_BLOCKS = 512;
// Wrapped rows touch or overlap; a sizeable positive gap is a normal next
// line and must not be collapsed into the same clickable block.
const OCR_MERGE_GAP_RATIO = 0.25;
const OCR_MERGE_OVERLAP_RATIO = 0.35;
// RapidOCR boxes include generous ascender/descender padding. Keep the browser
// glyphs close to the source size while reserving a small safety margin inside
// the detected line box.
const OCR_FONT_SIZE_RATIO = 0.76;
const OCR_MAX_LINE_OVERLAP_RATIO = 0.35;
const OCR_MAX_FRAGMENT_CENTER_RATIO = 0.5;
const OCR_MAX_FRAGMENT_GAP_RATIO = 2.4;
const OCR_MAX_OVERLAPPING_LINE_TEXT_LENGTH = 10;
const OCR_MAX_WRAPPED_CENTER_DISTANCE_RATIO = 1.25;
const OCR_MAX_FRAGMENT_TEXT_OVERLAP = 8;

const isPositiveFinite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;

/** Maps source-image coordinates to the letterboxed unit frame. */
export const resolveImageFrame = (
    unit: Unit,
    minified: boolean,
    imageWidth: unknown,
    imageHeight: unknown,
): OcrImageFrame | null => {
    if (!isPositiveFinite(imageWidth) || !isPositiveFinite(imageHeight)) return null;
    if (!isPositiveFinite(unit.w) || !isPositiveFinite(unit.h)) return null;

    if (minified) {
        return {
            left: 0,
            top: 0,
            width: unit.w,
            height: unit.h,
            scaleX: unit.w / imageWidth,
            scaleY: unit.h / imageHeight,
        };
    }

    const scale = Math.min(unit.w / imageWidth, unit.h / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return {
        left: (unit.w - width) / 2,
        top: (unit.h - height) / 2,
        width,
        height,
        scaleX: scale,
        scaleY: scale,
    };
};

/** Maps OCR image coordinates to the letterboxed unit frame. */
export const resolveOcrImageFrame = (unit: Unit, minified: boolean): OcrImageFrame | null => {
    const ocr = unit.data.ocrResult;
    return resolveImageFrame(unit, minified, ocr?.width, ocr?.height);
};

/** Intersects untrusted OCR geometry with the source area represented by a frame. */
export const clipOcrBoundsToFrame = (
    frame: OcrImageFrame,
    bounds: OcrBlockBounds,
): OcrBlockBounds | null => {
    if (
        ![frame.width, frame.height, frame.scaleX, frame.scaleY].every(isPositiveFinite)
        || ![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)
    ) return null;

    const sourceWidth = frame.width / frame.scaleX;
    const sourceHeight = frame.height / frame.scaleY;
    const minX = Math.max(0, Math.min(sourceWidth, bounds.minX));
    const maxX = Math.max(0, Math.min(sourceWidth, bounds.maxX));
    const minY = Math.max(0, Math.min(sourceHeight, bounds.minY));
    const maxY = Math.max(0, Math.min(sourceHeight, bounds.maxY));
    if (maxX <= minX || maxY <= minY) return null;
    return { minX, maxX, minY, maxY };
};

export const resolveOcrBlockBounds = (
    boxPoints: OcrBlock["boxPoints"] | undefined,
    coordinateScale?: number,
): OcrBlockBounds | null => {
    const effectiveCoordinateScale = coordinateScale === undefined ? 1 : coordinateScale;
    if (
        !Array.isArray(boxPoints)
        || boxPoints.length === 0
        || boxPoints.length > MAX_OCR_POINTS
        || !isPositiveFinite(effectiveCoordinateScale)
        || boxPoints.some((point) =>
            !Number.isFinite(point?.x)
            || !Number.isFinite(point?.y)
            || Math.abs(point.x / effectiveCoordinateScale) > MAX_OCR_COORDINATE_MAGNITUDE
            || Math.abs(point.y / effectiveCoordinateScale) > MAX_OCR_COORDINATE_MAGNITUDE)
    ) return null;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of boxPoints) {
        const x = point.x / effectiveCoordinateScale;
        const y = point.y / effectiveCoordinateScale;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    if (maxX <= minX || maxY <= minY) return null;
    return { minX, maxX, minY, maxY };
};

const horizontalOverlapRatio = (left: OcrBlockBounds, right: OcrBlockBounds) => {
    const overlap = Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX));
    const minimumWidth = Math.min(left.maxX - left.minX, right.maxX - right.minX);
    return minimumWidth > 0 ? overlap / minimumWidth : 0;
};

const verticalGap = (top: OcrBlockBounds, bottom: OcrBlockBounds) =>
    Math.max(0, bottom.minY - top.maxY);

const verticalOverlap = (top: OcrBlockBounds, bottom: OcrBlockBounds) =>
    Math.max(0, top.maxY - bottom.minY);

const horizontalGap = (left: OcrBlockBounds, right: OcrBlockBounds) =>
    Math.max(0, Math.max(left.minX, right.minX) - Math.min(left.maxX, right.maxX));

const canMergeOcrLines = (top: OcrOverlayBlock, bottom: OcrOverlayBlock) => {
    if (bottom.bounds.minY < top.bounds.minY) return false;
    // A detected list marker owns a new visual/clickable row. Treating it as a
    // wrapped continuation compresses the union box and destroys indentation.
    if (startsOcrListLine(bottom.text)) return false;
    const topHeight = top.bounds.maxY - top.bounds.minY;
    const bottomHeight = bottom.bounds.maxY - bottom.bounds.minY;
    const minimumHeight = Math.min(topHeight, bottomHeight);
    const overlapLimit = Math.max(2, minimumHeight * OCR_MAX_LINE_OVERLAP_RATIO);
    if (verticalOverlap(top.bounds, bottom.bounds) > 0) {
        const topCenterX = (top.bounds.minX + top.bounds.maxX) / 2;
        const bottomCenterX = (bottom.bounds.minX + bottom.bounds.maxX) / 2;
        if (Math.abs(topCenterX - bottomCenterX) > Math.max(topHeight, bottomHeight) * OCR_MAX_WRAPPED_CENTER_DISTANCE_RATIO) {
            return false;
        }
    }
    if (
        verticalOverlap(top.bounds, bottom.bounds) > 0
        && Array.from(top.text).length > OCR_MAX_OVERLAPPING_LINE_TEXT_LENGTH
        && Array.from(bottom.text).length > OCR_MAX_OVERLAPPING_LINE_TEXT_LENGTH
    ) {
        // Long rows with overlapping boxes are separate prose lines in
        // practice. Wrapped labels normally have a short continuation (such
        // as a folder suffix), which remains eligible for semantic merging.
        return false;
    }
    // Large vertical overlap is normally RapidOCR returning a second box for
    // the same scan row, not a wrapped line. Merging it would create a very
    // tall multi-line label whose font is visibly too small.
    if (verticalOverlap(top.bounds, bottom.bounds) > overlapLimit) return false;
    const topCenterY = (top.bounds.minY + top.bounds.maxY) / 2;
    const bottomCenterY = (bottom.bounds.minY + bottom.bounds.maxY) / 2;
    const minimumVerticalAdvance = minimumHeight * 0.35;
    if (bottomCenterY - topCenterY < minimumVerticalAdvance) return false;
    const gapLimit = Math.max(2, Math.min(topHeight, bottomHeight) * OCR_MERGE_GAP_RATIO);
    if (verticalGap(top.bounds, bottom.bounds) > gapLimit) return false;

    const overlapRatio = horizontalOverlapRatio(top.bounds, bottom.bounds);
    if (overlapRatio >= OCR_MERGE_OVERLAP_RATIO) return true;

    const topCenter = (top.bounds.minX + top.bounds.maxX) / 2;
    const bottomCenter = (bottom.bounds.minX + bottom.bounds.maxX) / 2;
    const topWidth = top.bounds.maxX - top.bounds.minX;
    const bottomWidth = bottom.bounds.maxX - bottom.bounds.minX;
    const maximumCenterDistance = Math.max(topWidth, bottomWidth) * 0.5;
    return Math.abs(topCenter - bottomCenter) <= maximumCenterDistance;
};

/** Returns true when two overlapping OCR boxes are fragments of one row. */
const canMergeOcrFragments = (left: OcrOverlayBlock, right: OcrOverlayBlock) => {
    const leftHeight = left.bounds.maxY - left.bounds.minY;
    const rightHeight = right.bounds.maxY - right.bounds.minY;
    const minimumHeight = Math.min(leftHeight, rightHeight);
    const leftCenterY = (left.bounds.minY + left.bounds.maxY) / 2;
    const rightCenterY = (right.bounds.minY + right.bounds.maxY) / 2;
    if (Math.abs(leftCenterY - rightCenterY) > minimumHeight * OCR_MAX_FRAGMENT_CENTER_RATIO) {
        return false;
    }

    // Two boxes covering the same horizontal area are duplicate detections;
    // leave them separate so the vertical pass can retain the better geometry.
    if (left.splitColumn || right.splitColumn) return false;
    if (horizontalOverlapRatio(left.bounds, right.bounds) >= 0.75) return false;
    return horizontalGap(left.bounds, right.bounds)
        <= Math.max(8, minimumHeight * OCR_MAX_FRAGMENT_GAP_RATIO);
};

const joinOcrLines = (first: string, second: string) => {
    const left = first.trim();
    const right = second.trim();
    if (!left) return right;
    if (!right) return left;
    if (/[㐀-鿿]$/.test(left) || /^[㐀-鿿]/.test(right)) return `${left}${right}`;
    if (/(?:-|\/|\(|\[)$/.test(left) || /^[,.;:!?)]/.test(right)) return `${left}${right}`;
    return `${left} ${right}`;
};

const joinOverlappingOcrFragments = (left: string, right: string) => {
    const leftText = left.trimEnd();
    const rightText = right.trimStart();
    const leftBoundary = Array.from(
        leftText.slice(-OCR_MAX_FRAGMENT_TEXT_OVERLAP * 2),
    ).slice(-OCR_MAX_FRAGMENT_TEXT_OVERLAP);
    const rightBoundary = Array.from(
        rightText.slice(0, OCR_MAX_FRAGMENT_TEXT_OVERLAP * 2),
    ).slice(0, OCR_MAX_FRAGMENT_TEXT_OVERLAP);
    const maximumOverlap = Math.min(
        OCR_MAX_FRAGMENT_TEXT_OVERLAP,
        leftBoundary.length,
        rightBoundary.length,
    );
    for (let length = maximumOverlap; length > 0; length -= 1) {
        const suffix = leftBoundary.slice(-length).join("").normalize("NFKC");
        const rawPrefix = rightBoundary.slice(0, length).join("");
        if (suffix === rawPrefix.normalize("NFKC")) {
            return joinOcrLines(leftText, rightText.slice(rawPrefix.length));
        }
    }
    return joinOcrLines(leftText, rightText);
};

const mergeOcrOverlayBlocks = (top: OcrOverlayBlock, bottom: OcrOverlayBlock): OcrOverlayBlock => ({
    // Keep the visual line break inside the shared box, but copy the semantic
    // name as one string so one click never produces two clipboard entries.
    text: `${top.text}\n${bottom.text}`,
    copyText: joinOcrLines(top.copyText, bottom.copyText),
    bounds: {
        minX: Math.min(top.bounds.minX, bottom.bounds.minX),
        maxX: Math.max(top.bounds.maxX, bottom.bounds.maxX),
        minY: Math.min(top.bounds.minY, bottom.bounds.minY),
        maxY: Math.max(top.bounds.maxY, bottom.bounds.maxY),
    },
    colorHex: top.colorHex,
    bgColorHex: top.bgColorHex,
    visualLines: [
        ...resolveOcrOverlayVisualLines(top),
        ...resolveOcrOverlayVisualLines(bottom),
    ],
});

const mergeOcrFragmentPair = (first: OcrOverlayBlock, second: OcrOverlayBlock): OcrOverlayBlock => {
    const [left, right] = first.bounds.minX <= second.bounds.minX
        ? [first, second]
        : [second, first];
    const overlapsHorizontally = Math.min(left.bounds.maxX, right.bounds.maxX)
        > Math.max(left.bounds.minX, right.bounds.minX);
    const text = overlapsHorizontally
        ? joinOverlappingOcrFragments(left.text, right.text)
        : joinOcrLines(left.text, right.text);
    const bounds = {
        minX: Math.min(first.bounds.minX, second.bounds.minX),
        maxX: Math.max(first.bounds.maxX, second.bounds.maxX),
        minY: Math.min(first.bounds.minY, second.bounds.minY),
        maxY: Math.max(first.bounds.maxY, second.bounds.maxY),
    };
    return {
        // Fragments share one baseline, so join them as one visual line rather
        // than introducing a newline and shrinking both pieces.
        text,
        copyText: overlapsHorizontally
            ? joinOverlappingOcrFragments(left.copyText, right.copyText)
            : joinOcrLines(left.copyText, right.copyText),
        bounds,
        colorHex: left.colorHex,
        bgColorHex: left.bgColorHex,
        visualLines: [{ text, bounds: { ...bounds } }],
    };
};

const mergeOcrLineFragments = (blocks: OcrOverlayBlock[]) => {
    const merged: OcrOverlayBlock[] = [];
    for (const candidate of blocks) {
        let mergeIndex = -1;
        for (let index = merged.length - 1; index >= 0; index -= 1) {
            if (canMergeOcrFragments(merged[index], candidate)) {
                mergeIndex = index;
                break;
            }
        }
        if (mergeIndex >= 0) {
            merged[mergeIndex] = mergeOcrFragmentPair(merged[mergeIndex], candidate);
        } else {
            merged.push(candidate);
        }
    }
    return merged;
};

/**
 * Splits detector rows that span an evidenced column grid, then groups OCR
 * lines that occupy one visual column into one clickable label. The vertical-
 * gap and horizontal-overlap guards keep neighbouring columns independent
 * while allowing wrapped folder names and translated labels.
 */
export const resolveOcrOverlayBlocks = (
    blocks: OcrBlock[] | undefined,
    coordinateScale?: number,
    resolveText: (block: OcrBlock) => string | undefined = (block) => block.text,
): OcrOverlayBlock[] => {
    if (!Array.isArray(blocks)) return [];
    const candidates = blocks.slice(0, MAX_OCR_OVERLAY_BLOCKS).flatMap((block) => {
        const bounds = resolveOcrBlockBounds(block.boxPoints, coordinateScale);
        const text = resolveText(block)?.trim();
        const lineGeometry = bounds
            ? normalizeOcrLineGeometry(block.lineGeometry, bounds, coordinateScale)
            : undefined;
        const spanGeometry = bounds
            ? resolveOcrOverlaySpanGeometry(
                block.characterSpans,
                block.wordSpans,
                text ?? "",
                bounds,
                coordinateScale,
            )
            : undefined;
        return bounds && text
            ? [{
                text,
                copyText: text,
                bounds,
                colorHex: block.colorHex,
                bgColorHex: block.bgColorHex,
                visualLines: [{ text, bounds: { ...bounds }, lineGeometry, spanGeometry }],
            }]
            : [];
    });

    const sorted = splitAbnormallyWideOcrBlocks(candidates).sort((left, right) =>
        left.bounds.minY - right.bounds.minY || left.bounds.minX - right.bounds.minX,
    );
    const lineFragments = mergeOcrLineFragments(sorted).sort((left, right) =>
        left.bounds.minY - right.bounds.minY || left.bounds.minX - right.bounds.minX,
    );
    const merged: OcrOverlayBlock[] = [];
    for (const candidate of lineFragments) {
        let mergeIndex = -1;
        for (let index = merged.length - 1; index >= 0; index -= 1) {
            if (canMergeOcrLines(merged[index], candidate)) {
                mergeIndex = index;
                break;
            }
        }
        if (mergeIndex >= 0) {
            merged[mergeIndex] = mergeOcrOverlayBlocks(merged[mergeIndex], candidate);
        } else {
            merged.push(candidate);
        }
    }
    return normalizeOcrRowGeometry(merged.slice(0, MAX_OCR_OVERLAY_BLOCKS)).map((block) => {
        const visualLines = resolveOcrOverlayVisualLines(block);
        if (visualLines.length !== 1) return block;
        return {
            ...block,
            visualLines: [{
                ...visualLines[0],
                bounds: { ...block.bounds },
                lineHeightHint: block.lineHeightHint,
                lineGeometry: remapOcrLineGeometry(
                    visualLines[0].lineGeometry,
                    visualLines[0].bounds,
                    block.bounds,
                ),
            }],
        };
    });
};

/**
 * Derives CSS typography from the detected glyph box instead of a fixed 10px
 * label. `lineHeight` is returned in CSS pixels (not a unitless multiplier).
 * A result-level hint keeps adjacent rows on one rhythm; a block-local height
 * remains the fallback for isolated or multiline detections.
 */
export const resolveOcrBlockPresentation = (
    frame: OcrImageFrame,
    bounds: OcrBlockBounds,
    lineCount = 1,
    lineHeightHint?: number,
): OcrBlockPresentation => {
    const visibleBounds = clipOcrBoundsToFrame(frame, bounds) ?? bounds;
    const width = Math.max((visibleBounds.maxX - visibleBounds.minX) * frame.scaleX, 1);
    const height = Math.max((visibleBounds.maxY - visibleBounds.minY) * frame.scaleY, 1);
    const safeLineCount = Number.isFinite(lineCount)
        ? Math.max(1, Math.min(MAX_OCR_LINES, Math.floor(lineCount)))
        : 1;
    const hintedLineHeight = isPositiveFinite(lineHeightHint)
        ? lineHeightHint * frame.scaleY
        : height / safeLineCount;
    const maximumLineHeight = safeLineCount > 1 ? height / safeLineCount : height;
    const lineHeight = Math.max(1, Math.min(maximumLineHeight, hintedLineHeight));
    const fontSize = Math.max(
        1,
        Math.min(96, lineHeight * OCR_FONT_SIZE_RATIO, Math.max(1, lineHeight - 1)),
    );
    const paddingX = Math.max(0, Math.min(4, fontSize * 0.08));
    return {
        left: frame.left + visibleBounds.minX * frame.scaleX,
        top: frame.top + visibleBounds.minY * frame.scaleY,
        width,
        height,
        fontSize,
        lineHeight,
        paddingX,
    };
};
