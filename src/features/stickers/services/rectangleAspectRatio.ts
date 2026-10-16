import type { StickerToolSettings } from "../types/stickerEditing";

/** 比例只接收有界正数，拒绝零、负数及非有限输入。 */
export const parseRectangleAspectRatio = (value: unknown): { text: string; ratio: number } | null => {
    if (typeof value !== "string" || value.length > 32) return null;
    const match = /^\s*(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width < 0.01 || height < 0.01 || width > 10000 || height > 10000) return null;
    return { text: `${width}:${height}`, ratio: width / height };
};

export const resolveShapeAspectRatio = (
    tool: string,
    settings: Pick<StickerToolSettings, "shapeAspectRatio">,
    forceSquare = false,
): number => !forceSquare && (tool === "shape-rect" || tool === "shape-round-rect" || tool === "shape-ellipse")
    ? parseRectangleAspectRatio(settings.shapeAspectRatio)?.ratio ?? 1 : 1;
