export const OCR_SANS_FONT_FAMILY =
    '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
export const OCR_MONOSPACE_FONT_FAMILY =
    'ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace';

const OCR_FONT_WEIGHT = 500;
const MAX_MEASUREMENT_CACHE_ENTRIES = 512;
const MAX_MEASUREMENT_TEXT_LENGTH = 4_096;
const MAX_FONT_GEOMETRY_SAMPLES = 64;
const MAX_POSITIVE_TRACKING_EM = 0.035;
const MAX_NEGATIVE_TRACKING_EM = 0.006;
const MIN_HORIZONTAL_SCALE = 0.96;
const MAX_HORIZONTAL_SCALE = 1.06;
const MIN_FONT_SIZE_SCALE = 0.98;
const MIN_CONTAINED_FONT_SIZE = 1;
const MAX_FONT_SIZE_SCALE = 1.08;
const MAX_FONT_TO_LINE_RATIO = 0.86;
const TYPOGRAPHY_EPSILON = 0.01;
const TERMINAL_STRONG_SIGNAL = /(?:[a-z]:[\\/]|(?:^|\s)[\w.-]+[\\/][\w./\\-]+|\.(?:exe|dll|json|sha256|rs|ts|tsx|ps1|zip)\b|sha-?\d+|[{}<>`]|\[|\])/iu;
const TERMINAL_WEAK_SIGNAL = /(?:--[\w-]+|\b[0-9a-f]{16,}\b|(?:^|\s)[-+*]\s|\b(?:ctrl|alt|shift)\+\S+)/iu;

export type OcrTextMeasure = (text: string, font: string) => number | null;

export interface OcrTextTypographyInput {
    text: string;
    width: number;
    paddingX: number;
    fontSize: number;
    lineHeight?: number;
    fontFamily: string;
    /** Small source glyphs prioritize complete visibility over exact font metrics. */
    containOverflow?: boolean;
    measureText?: OcrTextMeasure;
}

export interface OcrTextTypography {
    fontSize: number;
    letterSpacing: number;
    scaleX: number;
}

export interface OcrFontGeometrySample {
    text: string;
    width: number;
    paddingX: number;
    fontSize: number;
}

const OCR_MONOSPACE_CANDIDATES = [
    OCR_MONOSPACE_FONT_FAMILY,
    '"Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace',
    'Consolas, "Microsoft YaHei UI", "Microsoft YaHei", monospace',
] as const;
const OCR_SANS_CANDIDATES = [
    OCR_SANS_FONT_FAMILY,
    '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif',
] as const;

let measurementContext: CanvasRenderingContext2D | null | undefined;
let measurementContextDocument: Document | undefined;
const measurementCache = new Map<string, number>();

const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(maximum, Math.max(minimum, value));

const roundMetric = (value: number) => Math.round(value * 1_000) / 1_000;

const getMeasurementContext = () => {
    // Do not cache an SSR miss: the same test/runtime process may attach a DOM later.
    if (typeof document === "undefined") return null;
    if (measurementContextDocument === document && measurementContext !== undefined) {
        return measurementContext;
    }
    measurementContextDocument = document;
    try {
        measurementContext = document.createElement("canvas").getContext("2d");
    } catch {
        measurementContext = null;
    }
    return measurementContext;
};

const measureWithCanvas: OcrTextMeasure = (text, font) => {
    if (text.length > MAX_MEASUREMENT_TEXT_LENGTH) return null;
    const cacheKey = `${font}\u0000${text}`;
    const cached = measurementCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const context = getMeasurementContext();
    if (!context) return null;
    try {
        context.font = font;
        const width = context.measureText(text).width;
        if (!Number.isFinite(width) || width <= 0) return null;
        if (measurementCache.size >= MAX_MEASUREMENT_CACHE_ENTRIES) {
            const oldestKey = measurementCache.keys().next().value;
            if (oldestKey !== undefined) measurementCache.delete(oldestKey);
        }
        measurementCache.set(cacheKey, width);
        return width;
    } catch {
        return null;
    }
};

const median = (values: number[]) => {
    if (values.length === 0) return Number.POSITIVE_INFINITY;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
};

const scoreFontCandidate = (
    family: string,
    samples: readonly OcrFontGeometrySample[],
    measureText: OcrTextMeasure,
) => {
    const errors: number[] = [];
    for (const sample of samples.slice(0, MAX_FONT_GEOMETRY_SAMPLES)) {
        if (![sample.width, sample.paddingX, sample.fontSize].every(Number.isFinite)) continue;
        const availableWidth = sample.width - Math.max(0, sample.paddingX) * 2;
        if (availableWidth <= 0 || sample.fontSize <= 0) continue;
        let measuredWidth = 0;
        for (const line of sample.text.split(/\r\n|\r|\n/)) {
            if (Array.from(line.trim()).length < 4) continue;
            measuredWidth = Math.max(
                measuredWidth,
                measureText(line, `${OCR_FONT_WEIGHT} ${sample.fontSize}px ${family}`) ?? 0,
            );
        }
        if (measuredWidth > 0) errors.push(Math.abs(Math.log(measuredWidth / availableWidth)));
    }
    return errors.length >= 2 ? median(errors) : Number.POSITIVE_INFINITY;
};

/** Uses one family for an OCR group so adjacent rows cannot switch typefaces. */
export const resolveOcrOverlayFontFamily = (
    texts: readonly string[],
    geometrySamples: readonly OcrFontGeometrySample[] = [],
    measureText: OcrTextMeasure = measureWithCanvas,
) => {
    const samples = texts.map((text) => text.trim()).filter(Boolean);
    if (samples.length === 0) return OCR_SANS_FONT_FAMILY;
    const strongSignals = samples.filter((text) => TERMINAL_STRONG_SIGNAL.test(text)).length;
    const weakSignals = samples.filter((text) => TERMINAL_WEAK_SIGNAL.test(text)).length;
    const candidates = strongSignals >= 2
        || strongSignals / samples.length >= 0.34
        || (strongSignals >= 1 && weakSignals >= 1)
        ? OCR_MONOSPACE_CANDIDATES
        : OCR_SANS_CANDIDATES;
    let best: string = candidates[0];
    let bestScore = scoreFontCandidate(best, geometrySamples, measureText);
    for (const candidate of candidates.slice(1)) {
        const score = scoreFontCandidate(candidate, geometrySamples, measureText);
        if (score < bestScore) {
            best = candidate;
            bestScore = score;
        }
    }
    return best;
};

/** Fits browser glyph advances to a detector box without moving its hit target. */
export const resolveOcrTextTypography = ({
    text,
    width,
    paddingX,
    fontSize,
    lineHeight,
    fontFamily,
    containOverflow = false,
    measureText = measureWithCanvas,
}: OcrTextTypographyInput): OcrTextTypography => {
    const fallbackFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 1;
    if (![width, paddingX, fontSize].every(Number.isFinite) || width <= 0 || fontSize <= 0) {
        return { fontSize: fallbackFontSize, letterSpacing: 0, scaleX: 1 };
    }
    const font = `${OCR_FONT_WEIGHT} ${fontSize}px ${fontFamily}`;
    let widestText = "";
    let measuredWidth = 0;
    for (const line of text.split(/\r\n|\r|\n/)) {
        if (!line) continue;
        const measured = measureText(line, font);
        if (measured !== null && Number.isFinite(measured) && measured > measuredWidth) {
            measuredWidth = measured;
            widestText = line;
        }
    }
    if (!widestText || measuredWidth <= 0) return { fontSize, letterSpacing: 0, scaleX: 1 };

    const availableWidth = Math.max(1, width - Math.max(0, paddingX) * 2);
    const lineHeightScaleLimit = Number.isFinite(lineHeight) && (lineHeight ?? 0) > 0
        ? Math.max(MIN_FONT_SIZE_SCALE, (lineHeight as number) * MAX_FONT_TO_LINE_RATIO / fontSize)
        : MAX_FONT_SIZE_SCALE;
    const minimumFontSizeScale = containOverflow
        ? Math.min(MIN_FONT_SIZE_SCALE, MIN_CONTAINED_FONT_SIZE / fontSize)
        : MIN_FONT_SIZE_SCALE;
    const fontSizeScale = clamp(
        availableWidth / measuredWidth,
        minimumFontSizeScale,
        Math.min(MAX_FONT_SIZE_SCALE, lineHeightScaleLimit),
    );
    const fittedFontSize = fontSize * fontSizeScale;
    const fittedMeasuredWidth = measuredWidth * fontSizeScale;
    const gapCount = Math.max(0, Array.from(widestText).length - 1);
    const maximumPositiveTracking = fittedFontSize * MAX_POSITIVE_TRACKING_EM;
    const maximumNegativeTracking = fittedFontSize * MAX_NEGATIVE_TRACKING_EM;
    const letterSpacing = gapCount > 0
        ? clamp(
            (availableWidth - fittedMeasuredWidth) / gapCount,
            -maximumNegativeTracking,
            maximumPositiveTracking,
        )
        : 0;
    const trackedWidth = Math.max(1, fittedMeasuredWidth + letterSpacing * gapCount);
    const minimumHorizontalScale = containOverflow
        ? Math.min(MIN_HORIZONTAL_SCALE, availableWidth / trackedWidth)
        : MIN_HORIZONTAL_SCALE;
    const scaleX = clamp(availableWidth / trackedWidth, minimumHorizontalScale, MAX_HORIZONTAL_SCALE);
    return {
        fontSize: roundMetric(fittedFontSize),
        letterSpacing: Math.abs(letterSpacing) < TYPOGRAPHY_EPSILON ? 0 : roundMetric(letterSpacing),
        scaleX: Math.abs(scaleX - 1) < TYPOGRAPHY_EPSILON ? 1 : roundMetric(scaleX),
    };
};
