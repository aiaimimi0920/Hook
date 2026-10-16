import type { JavaScriptSurfaceHostDragStart } from "./javascriptSurfaceContracts";

export interface JavaScriptSurfaceFrameGeometry {
    bounds: DOMRect;
    scaleX: number;
    scaleY: number;
    localWidth: number;
    localHeight: number;
}

export interface JavaScriptSurfaceFramePoint {
    x: number;
    y: number;
    normalizedX: number;
    normalizedY: number;
}

/** Resolve coordinates against the browser's final rendered iframe geometry. */
export const resolveJavaScriptSurfaceFrameGeometry = (
    frame: HTMLIFrameElement,
    fallbackScale = 1,
): JavaScriptSurfaceFrameGeometry => {
    const bounds = frame.getBoundingClientRect();
    const fallback = Number.isFinite(fallbackScale) && fallbackScale > 0 ? fallbackScale : 1;
    const localWidth = frame.clientWidth || frame.offsetWidth || bounds.width / fallback || 1;
    const localHeight = frame.clientHeight || frame.offsetHeight || bounds.height / fallback || 1;
    const measuredScaleX = bounds.width / localWidth;
    const measuredScaleY = bounds.height / localHeight;
    return {
        bounds,
        scaleX: Number.isFinite(measuredScaleX) && measuredScaleX > 0 ? measuredScaleX : fallback,
        scaleY: Number.isFinite(measuredScaleY) && measuredScaleY > 0 ? measuredScaleY : fallback,
        localWidth,
        localHeight,
    };
};

export const resolveJavaScriptSurfaceFramePoint = (
    geometry: JavaScriptSurfaceFrameGeometry,
    clientX: number,
    clientY: number,
): JavaScriptSurfaceFramePoint => {
    const normalizedX = geometry.bounds.width > 0
        ? (clientX - geometry.bounds.left) / geometry.bounds.width
        : (clientX - geometry.bounds.left) / (geometry.localWidth * geometry.scaleX);
    const normalizedY = geometry.bounds.height > 0
        ? (clientY - geometry.bounds.top) / geometry.bounds.height
        : (clientY - geometry.bounds.top) / (geometry.localHeight * geometry.scaleY);
    return {
        x: normalizedX * geometry.localWidth,
        y: normalizedY * geometry.localHeight,
        normalizedX,
        normalizedY,
    };
};

export const resolveJavaScriptSurfaceHostClientPoint = (
    geometry: JavaScriptSurfaceFrameGeometry,
    point: Pick<JavaScriptSurfaceHostDragStart, "normalizedX" | "normalizedY">,
) => ({
    x: geometry.bounds.left + point.normalizedX * geometry.bounds.width,
    y: geometry.bounds.top + point.normalizedY * geometry.bounds.height,
});
