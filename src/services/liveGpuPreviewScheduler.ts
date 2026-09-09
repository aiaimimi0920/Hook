// One lease clock and one lazy Unit-geometry sample for all mounted Live previews.
export interface PreviewMeasurements {
    unitRects: () => ReadonlyMap<HTMLElement, DOMRect>;
}

const subscribers = new Set<(measurements: PreviewMeasurements) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule(delay: number) {
    if (timer !== undefined) clearTimeout(timer);
    if (subscribers.size > 0) timer = setTimeout(flush, delay);
}

function flush() {
    timer = undefined;
    let rects: Map<HTMLElement, DOMRect> | undefined;
    const measurements: PreviewMeasurements = {
        unitRects: () => rects ??= new Map(Array.from(document.querySelectorAll<HTMLElement>(".unit-container"))
            .map((unit) => [unit, unit.getBoundingClientRect()])),
    };
    for (const tick of subscribers) tick(measurements);
    schedule(80);
}

function invalidate() { schedule(0); }

export function subscribeLivePreview(tick: (measurements: PreviewMeasurements) => void) {
    if (subscribers.size === 0) {
        window.addEventListener("resize", invalidate);
        window.addEventListener("scroll", invalidate, true);
        document.addEventListener("visibilitychange", invalidate);
    }
    subscribers.add(tick);
    invalidate();
    return {
        invalidate,
        dispose() {
            subscribers.delete(tick);
            if (subscribers.size > 0) return;
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
            window.removeEventListener("resize", invalidate);
            window.removeEventListener("scroll", invalidate, true);
            document.removeEventListener("visibilitychange", invalidate);
        },
    };
}
