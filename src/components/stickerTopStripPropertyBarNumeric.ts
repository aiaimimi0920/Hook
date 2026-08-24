/** Parses a deferred integer draft while preserving the caller's current value on invalid input. */
export const parseCanvasStepperValue = (
    raw: string | null,
    fallback: number,
    min: number,
    max: number,
) => {
    if (raw == null) return fallback;
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};
