//! Selects one bounded, deterministic fill color for a sticker's OCR overlay.

export interface OcrOverlayColorSample {
    colorHex?: unknown;
    bgColorHex?: unknown;
}

export interface OcrOverlayFillColor {
    hex: string;
}

interface RgbColor {
    r: number;
    g: number;
    b: number;
}

interface FillScore {
    minimumDistance: number;
    minimumForegroundContrast: number;
}

const MAX_OCR_COLOR_SAMPLES = 512;
const DEFAULT_FOREGROUND: RgbColor = { r: 255, g: 255, b: 255 };
const DEFAULT_BACKGROUND: RgbColor = { r: 0, g: 0, b: 0 };
const HEX_COLOR = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i;

// Red and magenta remain reserved for errors and destructive actions. The
// remaining fixed grid still produces deterministic results for equal inputs.
const CANDIDATE_HUES = [210, 185, 250, 45, 85, 125, 160, 280, 225];
const CANDIDATE_SATURATIONS = [0.68, 0.84];
const CANDIDATE_VALUES = [0.26, 0.4, 0.56, 0.72, 0.88];

const parseHexColor = (value: unknown): RgbColor | null => {
    if (typeof value !== "string") return null;
    const match = HEX_COLOR.exec(value);
    if (!match) return null;
    return {
        r: Number.parseInt(match[1].slice(0, 2), 16),
        g: Number.parseInt(match[1].slice(2, 4), 16),
        b: Number.parseInt(match[1].slice(4, 6), 16),
    };
};

const isColorSample = (value: unknown): value is OcrOverlayColorSample =>
    typeof value === "object" && value !== null;

const fromHsv = (hue: number, saturation: number, value: number): RgbColor => {
    const chroma = value * saturation;
    const segment = hue / 60;
    const intermediate = chroma * (1 - Math.abs((segment % 2) - 1));
    const match = value - chroma;
    const channels = segment < 1 ? [chroma, intermediate, 0]
        : segment < 2 ? [intermediate, chroma, 0]
        : segment < 3 ? [0, chroma, intermediate]
        : segment < 4 ? [0, intermediate, chroma]
        : segment < 5 ? [intermediate, 0, chroma]
        : [chroma, 0, intermediate];
    return {
        r: Math.round((channels[0] + match) * 255),
        g: Math.round((channels[1] + match) * 255),
        b: Math.round((channels[2] + match) * 255),
    };
};

const packRgb = (color: RgbColor) => (color.r << 16) | (color.g << 8) | color.b;
const unpackRgb = (packed: number): RgbColor => ({
    r: (packed >> 16) & 0xff,
    g: (packed >> 8) & 0xff,
    b: packed & 0xff,
});
const toHex = (color: RgbColor) => `#${packRgb(color).toString(16).padStart(6, "0")}`;

const isRedLike = (color: RgbColor) => {
    const maximum = Math.max(color.r, color.g, color.b);
    const minimum = Math.min(color.r, color.g, color.b);
    const delta = maximum - minimum;
    if (delta === 0) return false;
    const hue = maximum === color.r
        ? 60 * (((color.g - color.b) / delta) % 6)
        : maximum === color.g
            ? 60 * ((color.b - color.r) / delta + 2)
            : 60 * ((color.r - color.g) / delta + 4);
    const normalizedHue = hue < 0 ? hue + 360 : hue;
    return normalizedHue <= 30 || normalizedHue >= 300;
};

// Red-mean distance is a small perceptual approximation suitable for this
// bounded UI search; contrast is retained as a deterministic tie-breaker.
const colorDistance = (left: RgbColor, right: RgbColor) => {
    const redMean = (left.r + right.r) / 2;
    const red = left.r - right.r;
    const green = left.g - right.g;
    const blue = left.b - right.b;
    return Math.sqrt(
        (2 + redMean / 256) * red * red
        + 4 * green * green
        + (2 + (255 - redMean) / 256) * blue * blue,
    );
};

const relativeLuminance = (color: RgbColor) => {
    const linear = (channel: number) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
};

const contrastRatio = (left: RgbColor, right: RgbColor) => {
    const leftLuminance = relativeLuminance(left);
    const rightLuminance = relativeLuminance(right);
    return (Math.max(leftLuminance, rightLuminance) + 0.05)
        / (Math.min(leftLuminance, rightLuminance) + 0.05);
};

const scoreFill = (
    fill: RgbColor,
    samples: readonly { foreground: RgbColor; background: RgbColor }[],
): FillScore => {
    let minimumDistance = Number.POSITIVE_INFINITY;
    let minimumForegroundContrast = Number.POSITIVE_INFINITY;
    for (const sample of samples) {
        minimumDistance = Math.min(
            minimumDistance,
            colorDistance(fill, sample.foreground),
            colorDistance(fill, sample.background),
        );
        minimumForegroundContrast = Math.min(
            minimumForegroundContrast,
            contrastRatio(fill, sample.foreground),
        );
    }
    return { minimumDistance, minimumForegroundContrast };
};

const createCandidateColors = (): RgbColor[] => CANDIDATE_HUES.flatMap((hue) =>
    CANDIDATE_SATURATIONS.flatMap((saturation) =>
        CANDIDATE_VALUES.map((value) => fromHsv(hue, saturation, value)),
    ),
);

/** Chooses one shared opaque color using all bounded OCR color samples. */
export const resolveOcrOverlayFillColor = (
    blocks: readonly (OcrOverlayColorSample | null | undefined)[] | null | undefined,
): OcrOverlayFillColor => {
    const source: readonly unknown[] = Array.isArray(blocks) ? blocks : [];
    const samples = source.slice(0, MAX_OCR_COLOR_SAMPLES).map((entry) => {
        const block = isColorSample(entry) ? entry : null;
        return {
            foreground: parseHexColor(block?.colorHex) ?? DEFAULT_FOREGROUND,
            background: parseHexColor(block?.bgColorHex) ?? DEFAULT_BACKGROUND,
        };
    });
    if (samples.length === 0) {
        samples.push({ foreground: DEFAULT_FOREGROUND, background: DEFAULT_BACKGROUND });
    }

    const occupied = new Set(samples.flatMap((sample) => [
        packRgb(sample.foreground),
        packRgb(sample.background),
    ]));
    const candidates = createCandidateColors().filter((candidate) =>
        !isRedLike(candidate) && !occupied.has(packRgb(candidate)));
    let fallback = 0x0050a0;
    for (let attempts = 0; occupied.has(fallback) && attempts <= MAX_OCR_COLOR_SAMPLES * 2; attempts += 1) {
        // There are at most 1024 occupied colors and 1025 distinct blue/cyan
        // candidates, so this bounded scan always finds a non-red color.
        fallback = 0x0050a0 + attempts + 1;
    }
    candidates.push(unpackRgb(fallback));

    let selected = candidates[0];
    let selectedScore = scoreFill(selected, samples);
    for (const candidate of candidates.slice(1)) {
        const score = scoreFill(candidate, samples);
        if (
            score.minimumForegroundContrast > selectedScore.minimumForegroundContrast
            || (
                score.minimumForegroundContrast === selectedScore.minimumForegroundContrast
                && score.minimumDistance > selectedScore.minimumDistance
            )
        ) {
            selected = candidate;
            selectedScore = score;
        }
    }

    const hex = toHex(selected);
    return { hex };
};

/** Preserves sampled text color when readable, otherwise selects a neutral accessible foreground. */
export const resolveOcrOverlayTextColor = (source: unknown, fillHex: string): string => {
    const fill = parseHexColor(fillHex) ?? unpackRgb(0x0050a0);
    const foreground = parseHexColor(source) ?? DEFAULT_FOREGROUND;
    if (contrastRatio(foreground, fill) >= 4.5) return toHex(foreground);
    const light = unpackRgb(0xf8fafc);
    const dark = unpackRgb(0x06080d);
    return toHex(
        contrastRatio(light, fill) >= contrastRatio(dark, fill) ? light : dark,
    );
};
