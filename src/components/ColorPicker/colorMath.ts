//! Pure, bounded color parsing and conversion for the picker.

export interface RgbaColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

export interface HsvColor {
    h: number;
    s: number;
    v: number;
}

const clamp = (value: number, minimum: number, maximum: number): number => {
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, value));
};

const clampByte = (value: number): number => Math.round(clamp(value, 0, 255));
const clampUnit = (value: number): number => clamp(value, 0, 1);

export const normalizeHexColor = (value: string): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "transparent") return "transparent";

    const cleaned = trimmed.replace(/^#/, "");
    if (!/^(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(cleaned)) {
        return null;
    }
    return `#${cleaned.toLowerCase()}`;
};

export const hexToRgb = (hex: string): RgbaColor => {
    const normalized = normalizeHexColor(hex);
    if (normalized === "transparent") {
        // Keep a neutral hue while representing a fully transparent slot.
        return { r: 255, g: 0, b: 0, a: 0 };
    }
    if (!normalized) {
        return { r: 255, g: 0, b: 0, a: 1 };
    }

    const cleaned = normalized.slice(1);
    return {
        r: Number.parseInt(cleaned.slice(0, 2), 16),
        g: Number.parseInt(cleaned.slice(2, 4), 16),
        b: Number.parseInt(cleaned.slice(4, 6), 16),
        a: cleaned.length === 8 ? Number.parseInt(cleaned.slice(6, 8), 16) / 255 : 1,
    };
};

export const rgbToHex = (r: number, g: number, b: number, a: number): string => {
    const toHex = (value: number) => clampByte(value).toString(16).padStart(2, "0");
    const safeAlpha = clampUnit(a);
    if (safeAlpha < 1) {
        return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(safeAlpha * 255)}`;
    }
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const rgbToHsv = (r: number, g: number, b: number): HsvColor => {
    const rNorm = clampByte(r) / 255;
    const gNorm = clampByte(g) / 255;
    const bNorm = clampByte(b) / 255;
    const maximum = Math.max(rNorm, gNorm, bNorm);
    const minimum = Math.min(rNorm, gNorm, bNorm);
    const delta = maximum - minimum;

    let hue = 0;
    if (delta !== 0) {
        if (maximum === rNorm) {
            hue = ((gNorm - bNorm) / delta) % 6;
        } else if (maximum === gNorm) {
            hue = (bNorm - rNorm) / delta + 2;
        } else {
            hue = (rNorm - gNorm) / delta + 4;
        }
        hue = Math.round(hue * 60);
        if (hue < 0) hue += 360;
    }

    return {
        h: hue,
        s: maximum === 0 ? 0 : delta / maximum,
        v: maximum,
    };
};

export const hsvToRgb = (h: number, s: number, v: number): Omit<RgbaColor, "a"> => {
    const hue = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
    const saturation = clampUnit(s);
    const value = clampUnit(v);
    const chroma = value * saturation;
    const intermediate = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const match = value - chroma;

    let red = 0;
    let green = 0;
    let blue = 0;
    if (hue < 60) {
        red = chroma;
        green = intermediate;
    } else if (hue < 120) {
        red = intermediate;
        green = chroma;
    } else if (hue < 180) {
        green = chroma;
        blue = intermediate;
    } else if (hue < 240) {
        green = intermediate;
        blue = chroma;
    } else if (hue < 300) {
        red = intermediate;
        blue = chroma;
    } else {
        red = chroma;
        blue = intermediate;
    }

    return {
        r: clampByte((red + match) * 255),
        g: clampByte((green + match) * 255),
        b: clampByte((blue + match) * 255),
    };
};
