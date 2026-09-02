// Derives plugin-scene typography from both OCR line height and available width.

const HEIGHT_RATIO = 0.74;
const WIDTH_SAFETY_RATIO = 0.94;
const NARROW_PUNCTUATION = new Set([
    "-", ".", ",", ":", ";", "!", "?", "'", "\"", "`", "|", "/", "\\",
    "(", ")", "[", "]", "{", "}",
]);

const characterAdvance = (character: string): number => {
    if (/\s/u.test(character)) return 0.32;
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(character)) return 1;
    if (/[MWmw@%]/u.test(character)) return 0.9;
    if (/[ilI1tf]/u.test(character)) return 0.4;
    if (/[A-Z]/u.test(character)) return 0.66;
    if (/[a-z0-9]/u.test(character)) return 0.56;
    if (/[_]/u.test(character)) return 0.58;
    if (NARROW_PUNCTUATION.has(character)) return 0.38;
    return 0.86;
};

const maximumLineAdvance = (text: string): number => Math.max(
    1,
    ...text.split("\n").map((line) =>
        Array.from(line).reduce((sum, character) => sum + characterAdvance(character), 0)),
);

export interface OcrSurfaceTypography {
    fontSize: string;
    lineHeight: string;
}

/** Uses independent container axes so aspect-ratio and zoom changes cannot crop text. */
export const resolveOcrSurfaceTypography = (
    text: string,
    width: number,
    lineHeight: number,
    sourceWidth: number,
    sourceHeight: number,
): OcrSurfaceTypography => {
    const heightBound = Math.max(0.001, Math.min(100, lineHeight / sourceHeight * 100 * HEIGHT_RATIO));
    const widthBound = Math.max(
        0.001,
        Math.min(100, width / sourceWidth * 100 / maximumLineAdvance(text) * WIDTH_SAFETY_RATIO),
    );
    const cssLineHeight = Math.max(0.001, Math.min(100, lineHeight / sourceHeight * 100));
    return {
        fontSize: `min(${heightBound.toFixed(4)}cqh, ${widthBound.toFixed(4)}cqw)`,
        lineHeight: `${cssLineHeight.toFixed(4)}cqh`,
    };
};
