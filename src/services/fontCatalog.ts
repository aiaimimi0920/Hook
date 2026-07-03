export const COMMON_STICKER_FONT_FAMILIES = [
    "微软雅黑",
    "宋体",
    "黑体",
    "楷体",
    "仿宋",
    "Arial",
    "Times New Roman",
    "Consolas",
    "Segoe UI",
];

const FONT_COLLATOR = new Intl.Collator("zh-CN", {
    sensitivity: "base",
    numeric: true,
});

export const mergeStickerFontFamilies = (installedFonts: string[]) => {
    const normalized = new Set(
        [...COMMON_STICKER_FONT_FAMILIES, ...installedFonts]
            .map((font) => font.trim())
            .filter((font) => font.length > 0),
    );

    const preset = COMMON_STICKER_FONT_FAMILIES.filter((font) => normalized.delete(font));
    const dynamic = Array.from(normalized).sort((left, right) => FONT_COLLATOR.compare(left, right));
    return [...preset, ...dynamic];
};
