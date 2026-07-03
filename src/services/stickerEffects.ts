import type { StickerImageEditState } from "../types/stickerEditing";

type Rect = { x: number; y: number; w: number; h: number };
type Size = { w: number; h: number };

export type EffectSourceProjection = {
    sourceX: number;
    sourceY: number;
    sourceW: number;
    sourceH: number;
    destX: number;
    destY: number;
    destW: number;
    destH: number;
};

export type MosaicPreviewCanvasSize = {
    width: number;
    height: number;
    scale: number;
};

export type PrivacyMosaicTile = {
    x: number;
    y: number;
    w: number;
    h: number;
    fill: string;
};

const PRIVACY_MOSAIC_COLORS = [
    "rgb(15, 23, 42)",
    "rgb(30, 41, 59)",
    "rgb(51, 65, 85)",
    "rgb(71, 85, 105)",
    "rgb(100, 116, 139)",
];

export const BLUR_EFFECT_OVERLAY_FILL = "rgba(255,255,255,0.08)";

// Decorative mosaic palette. The mosaic is a grid of square cells, but it NEVER
// samples the underlying image, so it cannot leak the censored content. The
// palette is a single soft blue-gray family with only slight lightness variation
// so the painted area reads as one calm surface, not jarring confetti.
const MOSAIC_CELL_COLORS = [
    "rgb(108, 122, 142)",
    "rgb(116, 130, 149)",
    "rgb(124, 138, 156)",
    "rgb(132, 145, 163)",
    "rgb(140, 153, 170)",
    "rgb(148, 160, 176)",
    "rgb(120, 134, 152)",
    "rgb(112, 126, 145)",
];

// Pick a cell's palette color from its ABSOLUTE (column, row) in the full sticker.
// Because the index depends on the absolute position — not a position within a
// small repeating tile — the grid has NO repeating period: every cell across the
// whole sticker is colored independently, so the eye never sees the same block of
// cells repeat. The hash is fully avalanched so neighbors look unrelated.
const mosaicCellColorIndex = (column: number, row: number, count: number) => {
    let h = Math.imul(column ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13) ^ row, 0xc2b2ae35);
    h ^= h >>> 16;
    h = Math.imul(h ^ Math.imul(row + 0x165667b1, 0x27d4eb2f), 0x9e3779b1);
    h ^= h >>> 15;
    return (h >>> 0) % count;
};

// Paint a full grid of square mosaic cells across the given area. Each cell is
// colored by its ABSOLUTE (column, row) so the whole grid is non-repeating. Used
// by both the live overlay (painted once into a sticker-sized offscreen canvas,
// then stroked as an <image> pattern) and the canvas export. Never reads image
// pixels.
//
// originX/originY are the absolute sticker-space coordinates of the canvas's
// top-left corner. The live overlay paints the whole sticker (origin 0,0) so the
// grid aligns to the sticker grid; the export paints only the stroke's bounding
// box, so it passes the box origin to keep the SAME absolute cell colors and grid
// alignment as the live preview.
export const paintMosaicGrid = (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    cell: number,
    originX = 0,
    originY = 0,
    colors = MOSAIC_CELL_COLORS,
) => {
    const size = Math.max(2, Math.round(cell));
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const palette = colors.length > 0 ? colors : MOSAIC_CELL_COLORS;
    // Absolute column/row of the first cell that covers the canvas top-left, and
    // the sub-cell pixel offset so cell boundaries land on the absolute grid.
    const baseCol = Math.floor(originX / size);
    const baseRow = Math.floor(originY / size);
    const offsetX = baseCol * size - originX;
    const offsetY = baseRow * size - originY;
    for (let py = offsetY; py < h; py += size) {
        for (let px = offsetX; px < w; px += size) {
            const column = baseCol + Math.round((px - offsetX) / size);
            const row = baseRow + Math.round((py - offsetY) / size);
            context.fillStyle = palette[mosaicCellColorIndex(column, row, palette.length)];
            context.fillRect(px, py, size, size);
        }
    }
};

// Build a sticker-sized mosaic-grid texture as a PNG data URL. The live overlay
// uses this as the <image> inside a sticker-sized (non-repeating) <pattern> and
// strokes the brush path with it, so a long stroke only updates the <path d> and
// the texture (built once per stroke) never repeats across the sticker.
export const buildMosaicTextureDataUrl = (
    width: number,
    height: number,
    cell: number,
): string | null => {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    if (!context) return null;
    paintMosaicGrid(context, w, h, cell);
    return canvas.toDataURL("image/png");
};

const normalizePrivacyMosaicTileSize = (strength: number) =>
    Math.max(8, Math.round(strength || 12));

const privacyMosaicColorIndex = (column: number, row: number, colorCount: number) => {
    const hash =
        Math.imul(column + 17, 73856093) +
        Math.imul(row + 31, 19349663) +
        Math.imul((column + 1) * (row + 1), 83492791);
    return Math.abs(hash) % colorCount;
};

export const buildPrivacyMosaicTiles = (
    rect: Rect,
    strength: number,
    colors = PRIVACY_MOSAIC_COLORS,
): PrivacyMosaicTile[] => {
    const tileSize = normalizePrivacyMosaicTileSize(strength);
    const width = Math.max(0, Math.ceil(rect.w));
    const height = Math.max(0, Math.ceil(rect.h));
    const palette = colors.length > 0 ? colors : PRIVACY_MOSAIC_COLORS;
    const tiles: PrivacyMosaicTile[] = [];

    for (let y = 0; y < height; y += tileSize) {
        for (let x = 0; x < width; x += tileSize) {
            const column = Math.floor(x / tileSize);
            const row = Math.floor(y / tileSize);
            tiles.push({
                x: rect.x + x,
                y: rect.y + y,
                w: Math.min(tileSize, width - x),
                h: Math.min(tileSize, height - y),
                fill: palette[privacyMosaicColorIndex(column, row, palette.length)],
            });
        }
    }

    return tiles;
};

export const computeMosaicPreviewCanvasSize = (
    size: Size,
    maxDimension = 512,
): MosaicPreviewCanvasSize => {
    const width = Math.max(1, Math.round(size.w));
    const height = Math.max(1, Math.round(size.h));
    const maxSize = Math.max(width, height);
    if (maxSize <= maxDimension) {
        return { width, height, scale: 1 };
    }

    const scale = maxDimension / maxSize;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        scale,
    };
};

const clampRectToBounds = (rect: Rect, bounds: Size): Rect | null => {
    const left = Math.max(0, rect.x);
    const top = Math.max(0, rect.y);
    const right = Math.min(bounds.w, rect.x + rect.w);
    const bottom = Math.min(bounds.h, rect.y + rect.h);
    if (right <= left || bottom <= top) {
        return null;
    }
    return {
        x: left,
        y: top,
        w: right - left,
        h: bottom - top,
    };
};

export const computeEffectSourceProjection = (
    effectRect: Rect,
    stickerSize: Size,
    sourceSize: Size,
    imageEditState: Pick<StickerImageEditState, "cropRect" | "sourceSize"> | undefined,
): EffectSourceProjection | null => {
    const clipped = clampRectToBounds(effectRect, stickerSize);
    if (!clipped) return null;

    const cropRect = imageEditState?.cropRect;
    const cropSourceSize = imageEditState?.sourceSize;
    if (cropRect && cropSourceSize) {
        return {
            sourceX: cropRect.x + clipped.x,
            sourceY: cropRect.y + clipped.y,
            sourceW: clipped.w,
            sourceH: clipped.h,
            destX: clipped.x - effectRect.x,
            destY: clipped.y - effectRect.y,
            destW: clipped.w,
            destH: clipped.h,
        };
    }

    const scale = Math.min(stickerSize.w / sourceSize.w, stickerSize.h / sourceSize.h);
    const drawnWidth = sourceSize.w * scale;
    const drawnHeight = sourceSize.h * scale;
    const offsetX = (stickerSize.w - drawnWidth) / 2;
    const offsetY = (stickerSize.h - drawnHeight) / 2;

    const intersect = clampRectToBounds(
        {
            x: clipped.x - offsetX,
            y: clipped.y - offsetY,
            w: clipped.w,
            h: clipped.h,
        },
        { w: drawnWidth, h: drawnHeight },
    );
    if (!intersect) return null;

    return {
        sourceX: intersect.x / scale,
        sourceY: intersect.y / scale,
        sourceW: intersect.w / scale,
        sourceH: intersect.h / scale,
        destX: offsetX + intersect.x - effectRect.x,
        destY: offsetY + intersect.y - effectRect.y,
        destW: intersect.w,
        destH: intersect.h,
    };
};

export const renderMosaicToCanvas = (
    context: CanvasRenderingContext2D,
    _source: CanvasImageSource,
    projection: EffectSourceProjection,
    strength: number,
    colors?: string[],
) => {
    const rect = {
        x: projection.destX,
        y: projection.destY,
        w: projection.destW,
        h: projection.destH,
    };

    context.save();
    context.beginPath();
    context.rect(rect.x, rect.y, rect.w, rect.h);
    context.clip();

    for (const tile of buildPrivacyMosaicTiles(rect, strength, colors)) {
        context.fillStyle = tile.fill;
        context.fillRect(tile.x, tile.y, tile.w, tile.h);
    }

    context.restore();
};

export const translateEffectProjection = (
    projection: EffectSourceProjection,
    offset: { x: number; y: number },
): EffectSourceProjection => ({
    ...projection,
    destX: projection.destX + offset.x,
    destY: projection.destY + offset.y,
});

export const renderBlurToCanvas = (
    context: CanvasRenderingContext2D,
    source: CanvasImageSource,
    projection: EffectSourceProjection,
    strength: number,
) => {
    const blurRadius = Math.max(1, Math.round(strength || 8));

    context.save();
    context.beginPath();
    context.rect(projection.destX, projection.destY, projection.destW, projection.destH);
    context.clip();
    context.filter = `blur(${blurRadius}px)`;
    context.drawImage(
        source,
        projection.sourceX,
        projection.sourceY,
        projection.sourceW,
        projection.sourceH,
        projection.destX,
        projection.destY,
        projection.destW,
        projection.destH,
    );
    context.restore();
};

export const buildMosaicPreviewDataUrl = (params: {
    image: HTMLImageElement;
    effectRect: Rect;
    stickerSize: Size;
    imageEditState: Pick<StickerImageEditState, "cropRect" | "sourceSize"> | undefined;
    strength: number;
    maxPreviewDimension?: number;
}) => {
    const sourceWidth = params.image.naturalWidth || params.image.width;
    const sourceHeight = params.image.naturalHeight || params.image.height;
    const projection = computeEffectSourceProjection(
        params.effectRect,
        params.stickerSize,
        { w: sourceWidth, h: sourceHeight },
        params.imageEditState,
    );
    if (!projection) return null;

    const previewSize = computeMosaicPreviewCanvasSize(
        { w: params.effectRect.w, h: params.effectRect.h },
        params.maxPreviewDimension ?? 512,
    );
    const canvas = document.createElement("canvas");
    canvas.width = previewSize.width;
    canvas.height = previewSize.height;
    const context = canvas.getContext("2d");
    if (!context) return null;

    renderMosaicToCanvas(
        context,
        params.image,
        {
            ...projection,
            destX: projection.destX * previewSize.scale,
            destY: projection.destY * previewSize.scale,
            destW: projection.destW * previewSize.scale,
            destH: projection.destH * previewSize.scale,
        },
        Math.max(1, params.strength * previewSize.scale),
    );
    return canvas.toDataURL("image/png");
};
