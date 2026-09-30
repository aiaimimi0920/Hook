import type { OcrOverlayBlock } from "./ocrOverlayLayout";

const MAX_HORIZONTAL_SPLIT_COLUMNS = 4;
const OCR_HORIZONTAL_SPLIT_RATIO = 1.65;
const OCR_MAX_EQUAL_SPLIT_TEXT_LENGTH = 16;
const OCR_BULLET_MARKER = /^\s*[-‐‑‒–—―•▪▫◦‣⁃*+]\s*/u;
const OCR_NUMBERED_MARKER = /^\s*(?:(?:\d{1,3}|[a-z])[.)、](?:\s+|(?=[㐀-鿿])|$)|[（(](?:\d{1,3}|[a-z])[）)]\s*)/iu;
const OCR_HEADING_MARKER = /^\s*(?:#{1,6}\s*|[一二三四五六七八九十百]+[、.)）])/u;
const OCR_SENTENCE_ENDING = /[。！？!?；;：:]\s*$/u;
const OCR_MARKER_PREFIX_LENGTH = 64;

const normalizeMarkerPrefix = (text: string) =>
    text.slice(0, OCR_MARKER_PREFIX_LENGTH).normalize("NFKC");

export const startsOcrListLine = (text: string) => {
    const prefix = normalizeMarkerPrefix(text);
    return OCR_BULLET_MARKER.test(prefix) || OCR_NUMBERED_MARKER.test(prefix);
};

const startsStructuredOcrRow = (text: string) => {
    const prefix = normalizeMarkerPrefix(text);
    return startsOcrListLine(prefix)
        || OCR_HEADING_MARKER.test(prefix)
        || OCR_SENTENCE_ENDING.test(text);
};

const sharesRowWithStructuredText = (
    block: OcrOverlayBlock,
    index: number,
    blocks: OcrOverlayBlock[],
    structuredRows: readonly boolean[],
) => {
    const blockHeight = block.bounds.maxY - block.bounds.minY;
    const blockCenter = (block.bounds.minY + block.bounds.maxY) / 2;
    return blocks.some((sibling, siblingIndex) => {
        if (siblingIndex === index || !structuredRows[siblingIndex]) return false;
        const siblingHeight = sibling.bounds.maxY - sibling.bounds.minY;
        const siblingCenter = (sibling.bounds.minY + sibling.bounds.maxY) / 2;
        return Math.abs(blockCenter - siblingCenter) <= Math.min(blockHeight, siblingHeight) * 0.55;
    });
};

const median = (values: number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
};

const splitTextAcrossColumns = (text: string, columnCount: number) => {
    const characters = Array.from(text.trim());
    if (columnCount <= 1 || characters.length < columnCount * 2) return [text.trim()];

    const firstCharacter = characters[0] ?? "";
    const firstTwoCharacters = characters.slice(0, Math.min(2, characters.length)).join("");
    const repeatedPrefix = /^[㐀-鿿]{2}$/.test(firstTwoCharacters)
        ? firstTwoCharacters
        : /^[㐀-鿿]$/.test(firstCharacter)
            ? firstCharacter
            : firstTwoCharacters;
    const repeatedStartPositions: number[] = [];
    for (let index = 0; index <= characters.length - repeatedPrefix.length; index += 1) {
        if (characters.slice(index, index + repeatedPrefix.length).join("") === repeatedPrefix) {
            repeatedStartPositions.push(index);
        }
    }
    const starts = [0];
    for (let column = 1; column < columnCount; column += 1) {
        const expected = Math.round(characters.length * column / columnCount);
        const tolerance = Math.max(1, Math.ceil(characters.length / columnCount * 0.4));
        const candidate = repeatedStartPositions
            .filter((position) => position > starts[starts.length - 1])
            .sort((left, right) => Math.abs(left - expected) - Math.abs(right - expected))[0];
        if (candidate === undefined || Math.abs(candidate - expected) > tolerance) {
            starts.length = 1;
            break;
        }
        starts.push(candidate);
    }

    if (starts.length !== columnCount) {
        // Equal-width fallback is useful for compact CJK folder labels, but it
        // corrupts ordinary long sentences by splitting Latin words and numbers.
        if (characters.length > OCR_MAX_EQUAL_SPLIT_TEXT_LENGTH) return [text.trim()];
        starts.length = 0;
        for (let column = 0; column < columnCount; column += 1) {
            starts.push(Math.round(characters.length * column / columnCount));
        }
    }
    return starts.map((start, index) =>
        characters.slice(start, starts[index + 1] ?? characters.length).join("").trim(),
    );
};

const splitWideOcrBlock = (
    block: OcrOverlayBlock,
    referenceWidth: number,
    siblingCenters: number[],
): OcrOverlayBlock[] => {
    const width = block.bounds.maxX - block.bounds.minX;
    const widthRatio = referenceWidth > 0 ? width / referenceWidth : 1;
    const columnCount = Math.min(MAX_HORIZONTAL_SPLIT_COLUMNS, Math.max(1, Math.round(widthRatio)));
    if (columnCount < 2 || widthRatio < OCR_HORIZONTAL_SPLIT_RATIO) return [block];

    const columnWidth = width / columnCount;
    const columnCenters = Array.from({ length: columnCount }, (_, index) =>
        block.bounds.minX + columnWidth * (index + 0.5),
    );
    const evidenceColumns = new Set(
        siblingCenters.flatMap((center) => {
            const column = columnCenters.findIndex(
                (columnCenter) => Math.abs(center - columnCenter) <= columnWidth * 0.45,
            );
            return column >= 0 ? [column] : [];
        }),
    );
    if (evidenceColumns.size < columnCount) return [block];

    const textSegments = splitTextAcrossColumns(block.text, columnCount);
    if (textSegments.length !== columnCount || textSegments.some((text) => !text)) return [block];
    return textSegments.map((text, index) => {
        const bounds = {
            minX: block.bounds.minX + columnWidth * index,
            maxX: index === columnCount - 1
                ? block.bounds.maxX
                : block.bounds.minX + columnWidth * (index + 1),
            minY: block.bounds.minY,
            maxY: block.bounds.maxY,
        };
        return {
            ...block,
            text,
            copyText: text,
            splitColumn: true,
            bounds,
            visualLines: [{ text, bounds: { ...bounds } }],
        };
    });
};

/** Splits only compact label grids; structured document rows remain authoritative. */
export const splitAbnormallyWideOcrBlocks = (blocks: OcrOverlayBlock[]) => {
    const structuredRows = blocks.map((block) => startsStructuredOcrRow(block.text));
    const widths = blocks.map((block) => block.bounds.maxX - block.bounds.minX);
    const heights = blocks.map((block) => block.bounds.maxY - block.bounds.minY);
    const referenceWidth = Math.max(median(widths), median(heights) * 3);
    return blocks.flatMap((block, index) => {
        // Document markers and their same-row detector fragments are never
        // reinterpreted as a compact desktop-label grid.
        if (structuredRows[index] || sharesRowWithStructuredText(block, index, blocks, structuredRows)) {
            return [block];
        }
        const blockHeight = block.bounds.maxY - block.bounds.minY;
        const siblingCenters = blocks.flatMap((sibling, siblingIndex) => {
            const siblingHeight = sibling.bounds.maxY - sibling.bounds.minY;
            if (
                siblingIndex === index
                || siblingHeight < blockHeight * 0.45
                || siblingHeight > blockHeight * 2.2
            ) return [];
            return [(sibling.bounds.minX + sibling.bounds.maxX) / 2];
        });
        return splitWideOcrBlock(block, referenceWidth, siblingCenters);
    });
};
