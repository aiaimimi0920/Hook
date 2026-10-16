import type { LiveCaptureInputPayload } from "./liveCapture";

export function liveNormalizedPoint(
    rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
    source: { width: number; height: number },
    clientX: number,
    clientY: number,
    clampOutside = false,
    fit: "contain" | "fill" = "contain",
): { normalizedX: number; normalizedY: number } | undefined {
    const viewportWidth = Math.max(1, rect.width);
    const viewportHeight = Math.max(1, rect.height);
    const sourceWidth = Math.max(1, source.width);
    const sourceHeight = Math.max(1, source.height);
    const scale = fit === "fill"
        ? undefined
        : Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
    const width = scale === undefined ? viewportWidth : sourceWidth * scale;
    const height = scale === undefined ? viewportHeight : sourceHeight * scale;
    const left = rect.left + (viewportWidth - width) / 2;
    const top = rect.top + (viewportHeight - height) / 2;
    if (!clampOutside && (
        clientX < left || clientX > left + width || clientY < top || clientY > top + height
    )) return undefined;
    return {
        normalizedX: Math.min(1, Math.max(0, (clientX - left) / width)),
        normalizedY: Math.min(1, Math.max(0, (clientY - top) / height)),
    };
}

export function tryCaptureLivePointer(
    target: Pick<Element, "setPointerCapture">,
    pointerId: number,
    isTrusted: boolean,
): boolean {
    if (!isTrusted) return false;
    try {
        target.setPointerCapture(pointerId);
        return true;
    } catch {
        return false;
    }
}

export function releaseLivePointer(
    target: Pick<Element, "hasPointerCapture" | "releasePointerCapture">,
    pointerId: number,
): void {
    try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } catch {
        // Synthetic overlay events do not own a browser pointer capture.
    }
}

export function liveMouseButton(button: number): "left" | "right" | "middle" | undefined {
    if (button === 0) return "left";
    if (button === 1) return "middle";
    if (button === 2) return "right";
    return undefined;
}

export function liveWheelPayload(event: Pick<WheelEvent, "deltaX" | "deltaY">): Pick<
    LiveCaptureInputPayload,
    "wheelAxis" | "wheelDelta"
> {
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const raw = horizontal ? event.deltaX : event.deltaY;
    const direction = raw === 0 ? 0 : raw > 0 ? -1 : 1;
    return {
        wheelAxis: horizontal ? "horizontal" : "vertical",
        wheelDelta: direction * 120,
    };
}

export function liveVirtualKey(event: Pick<KeyboardEvent, "keyCode">): number | undefined {
    return Number.isInteger(event.keyCode) && event.keyCode >= 1 && event.keyCode <= 254
        ? event.keyCode
        : undefined;
}
