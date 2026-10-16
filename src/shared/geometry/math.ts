/**
 * Clamp a value between min and max bounds.
 * If max < min, returns min.
 */
export const clamp = (value: number, min: number, max: number): number => {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
};

/**
 * Clamp a value with optional min/max bounds.
 * If bounds are not provided or invalid, they are ignored.
 */
export const clampOptional = (value: number, min?: number, max?: number): number => {
    let next = value;
    if (typeof min === "number" && Number.isFinite(min)) next = Math.max(min, next);
    if (typeof max === "number" && Number.isFinite(max)) next = Math.min(max, next);
    return next;
};

/**
 * Normalize floating-point precision artifacts.
 */
export const normalizePrecision = (value: number): number => Number(value.toFixed(10));
