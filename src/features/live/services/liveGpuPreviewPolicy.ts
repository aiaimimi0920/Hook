// Conservative first-slice eligibility: unsupported visuals keep normal Unit rendering.
export interface GpuPreviewRect { x: number; y: number; width: number; height: number }
export interface GpuPreviewLayout extends GpuPreviewRect { inset: number }

// Mirror centered object-fit:contain pixels, not the possibly letterboxed img box.
export function containedPreviewRect(
    box: GpuPreviewRect, naturalWidth: number, naturalHeight: number,
): GpuPreviewRect | null {
    if (![box.x, box.y, box.width, box.height, naturalWidth, naturalHeight].every(Number.isFinite)
        || box.width <= 0 || box.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return null;
    const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
    const width = naturalWidth * scale, height = naturalHeight * scale;
    return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

export function rectanglesOverlap(a: GpuPreviewRect, b: GpuPreviewRect): boolean {
    return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
        && a.x < b.x + b.width && a.x + a.width > b.x
        && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function physicalPreviewLayout(
    rect: GpuPreviewRect,
    viewport: { width: number; height: number },
    dpr: number,
    occluders: readonly GpuPreviewRect[],
): GpuPreviewLayout | null {
    if (![rect.x, rect.y, rect.width, rect.height, dpr, viewport.width, viewport.height].every(Number.isFinite)
        || dpr <= 0 || dpr > 8 || rect.width <= 8 || rect.height <= 8
        || rect.x < 0 || rect.y < 0 || rect.x + rect.width > viewport.width
        || rect.y + rect.height > viewport.height) return null;
    // The native plane never paints its 2 CSS-pixel border. Comparing that
    // unpainted edge to logical port bounds falsely overlaps after DOM DPI rounding.
    const inset = 2;
    const painted = { x: rect.x + inset, y: rect.y + inset,
        width: rect.width - 2 * inset, height: rect.height - 2 * inset };
    if (occluders.some((other) => rectanglesOverlap(painted, other))) return null;
    const layout = {
        x: rect.x * dpr, y: rect.y * dpr,
        width: rect.width * dpr, height: rect.height * dpr, inset: inset * dpr,
    };
    return layout.width <= 16_384 && layout.height <= 16_384 ? layout : null;
}
