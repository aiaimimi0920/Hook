import { measureTextWidth } from "./stickerTextGeometry";

/** Return a UTF-16 input offset without splitting a visible grapheme. */
export const findTextCaretOffset = (
    text: string, x: number, fontSize: number, fontFamily: string,
): number => {
    const boundaries = [0];
    const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
    for (const segment of segments) boundaries.push(segment.index + segment.segment.length);
    const widthAt = (index: number) => index === 0 ? 0
        : measureTextWidth(text.slice(0, boundaries[index]), fontSize, "500", fontFamily);
    let low = 0;
    let high = boundaries.length - 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (widthAt(mid) < x) low = mid + 1;
        else high = mid;
    }
    if (low === 0) return 0;
    return boundaries[x - widthAt(low - 1) <= widthAt(low) - x ? low - 1 : low];
};
