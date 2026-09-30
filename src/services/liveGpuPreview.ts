import { createEffect, onCleanup, onMount } from "solid-js";
import { safeInvoke, isTauriRuntimeAvailable } from "./apiTransport";
import { liveCaptureViews } from "../store/liveCaptureStore";
import { graphStore } from "../store/graphStore";
import { activeStickerEditTargetId, draggingStickerId, isSelecting } from "../store/uiStore";
import { extraRects } from "./uiRegistry";
import { containedPreviewRect, physicalPreviewLayout, type GpuPreviewLayout } from "./liveGpuPreviewPolicy";
import { refreshLiveCaptureHandoff } from "./liveCaptureHandoff";
import { setLiveGpuPresenting } from "./liveCapturePollCadence";
import { subscribeLivePreview, type PreviewMeasurements } from "./liveGpuPreviewScheduler";

interface PreviewStatus {
    available: boolean;
    presenting: boolean;
    submittedFrames: number;
    replacedFrames: number;
    cpuReadbacksSkipped?: number;
    error?: string;
}

const available = () => {
    if (!isTauriRuntimeAvailable()) return Promise.resolve(false);
    return safeInvoke<boolean>("get_live_gpu_preview_capability", undefined).catch(() => false);
};

// Native slots expire after 350 ms. Two layout ticks leave room for IPC jitter;
// never renew the presentation lease from cached geometry alone.
const STABLE_REFRESH_MS = 160;
const sameLayout = (a: GpuPreviewLayout | undefined, b: GpuPreviewLayout) =>
    a?.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.inset === b.inset;

// Unsupported composition keeps the ordinary image; native health controls CPU suppression.
export function registerLiveGpuPreview(
    image: HTMLImageElement,
    unitId: () => string,
    disabled: () => boolean,
): void {
    let disposed = false;
    let gpuEnabled = false;
    let subscription: ReturnType<typeof subscribeLivePreview> | undefined;
    let pending: Promise<void> | undefined;
    let registeredId: string | undefined;
    let requested = false;
    let lastVisible: boolean | undefined;
    let acknowledgedLayout: GpuPreviewLayout | undefined;
    let refreshAt = 0;
    let resized: ResizeObserver | undefined;

    const layout = (measurements: PreviewMeasurements, box: DOMRect): GpuPreviewLayout | null => {
        const unit = image.closest<HTMLElement>(".unit-container");
        if (disabled() || !image.isConnected || !unit || document.visibilityState === "hidden"
            || activeStickerEditTargetId() || draggingStickerId() || isSelecting()
            || graphStore.units.length > 32) return null;
        const visual = image.closest<HTMLElement>(".sticker-visual");
        if (!visual || getComputedStyle(visual).opacity !== "1"
            || unit.querySelector("[data-sticker-annotation-id], [data-hook-unit-notice-layer], .extension-unit-surface, .extension-attachment-placeholder")) return null;
        const style = getComputedStyle(image);
        if (style.transform !== "none" && style.transform !== "matrix(1, 0, 0, 1, 0, 0)") return null;
        if (style.objectFit !== "contain" || style.objectPosition !== "50% 50%") return null;
        const rect = containedPreviewRect(box, image.naturalWidth, image.naturalHeight);
        if (!rect) return null;
        const occluders = [...extraRects(), ...Array.from(measurements.unitRects())
            .filter(([other]) => other !== unit).map(([, rect]) => rect)];
        return physicalPreviewLayout(rect, { width: innerWidth, height: innerHeight }, devicePixelRatio, occluders);
    };

    const configure = (id: string, next: GpuPreviewLayout | null, visible = true) =>
        safeInvoke<PreviewStatus>("configure_live_gpu_preview", { sessionId: id, layout: next, visible });

    const isVisible = (rect = image.getBoundingClientRect()) => {
        return document.visibilityState !== "hidden" && image.isConnected
            && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
            && rect.left < innerWidth && rect.top < innerHeight;
    };

    const tick = (measurements: PreviewMeasurements) => {
        if (disposed) return;
        if (pending) return;
        pending = (async () => {
            const id = unitId();
            if (registeredId && registeredId !== id) {
                setLiveGpuPresenting(registeredId, false);
                await configure(registeredId, null).catch(() => undefined);
                registeredId = undefined;
                requested = false;
                lastVisible = undefined;
                acknowledgedLayout = undefined;
                subscription?.invalidate();
                return;
            }
            if (disposed) return;
            const live = liveCaptureViews.find((view) => view.sessionId === id);
            if (live?.status.captureState !== "streaming" && !requested) return;
            const box = image.getBoundingClientRect();
            let visible = isVisible(box);
            const next = visible && gpuEnabled && live?.status.captureState === "streaming" && image.complete
                ? layout(measurements, box) : null;
            if (!next && !requested && lastVisible === visible) return;
            if (next && lastVisible === visible && sameLayout(acknowledgedLayout, next)
                && performance.now() < refreshAt) return;
            registeredId = id;
            if (!next && requested) {
                setLiveGpuPresenting(id, false);
                // Read/decode the retained GPU frame even when the source is now static.
                // On failure native fallback/recovery still runs; never leave an orphan cover.
                await refreshLiveCaptureHandoff(id).catch(() => undefined);
                if (disposed) return;
                if (id !== unitId()) {
                    await configure(id, null).catch(() => undefined);
                    registeredId = undefined;
                    requested = false;
                    lastVisible = undefined;
                    acknowledgedLayout = undefined;
                    subscription?.invalidate();
                    return;
                }
                visible = isVisible();
            }
            requested = next !== null;
            const status = await configure(id, next, visible);
            lastVisible = visible;
            if (disposed) return;
            if (id !== unitId()) {
                await configure(id, null).catch(() => undefined);
                registeredId = undefined;
                requested = false;
                acknowledgedLayout = undefined;
                subscription?.invalidate();
                return;
            }
            const presenting = status.presenting && next !== null && !status.error;
            acknowledgedLayout = presenting ? next : undefined;
            refreshAt = performance.now() + STABLE_REFRESH_MS;
            setLiveGpuPresenting(id, presenting);
            image.dataset.liveGpuPreview = presenting ? "gpu-mirror" : "jpeg";
            image.dataset.liveGpuSubmitted = String(status.submittedFrames);
            image.dataset.liveGpuCpuSkipped = String(status.cpuReadbacksSkipped ?? 0);
            if (status.error) {
                image.dataset.liveGpuError = status.error;
                gpuEnabled = false;
                requested = false;
                if (next) await configure(id, null, visible).catch(() => undefined);
            }
        })().catch(() => {
            acknowledgedLayout = undefined;
            if (registeredId) setLiveGpuPresenting(registeredId, false);
            image.dataset.liveGpuPreview = "jpeg";
        }).finally(() => {
            pending = undefined;
        });
    };

    onMount(() => {
        if (!isTauriRuntimeAvailable() || !liveCaptureViews.some((view) => view.sessionId === unitId())) return;
        void available().then((supported) => {
            if (disposed) return;
            gpuEnabled = supported;
            // CPU compatibility mode needs the same visibility budget, even after GPU faults.
            subscription = subscribeLivePreview(tick);
            resized = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => subscription?.invalidate());
            resized?.observe(image);
        });
    });
    createEffect(() => {
        disabled(); activeStickerEditTargetId(); draggingStickerId(); isSelecting(); extraRects();
        subscription?.invalidate();
    });
    onCleanup(() => {
        disposed = true;
        if (registeredId) setLiveGpuPresenting(registeredId, false);
        resized?.disconnect();
        subscription?.dispose();
        // A late activation must be followed by disable, never recreate an orphan.
        void (pending ?? Promise.resolve()).then(() => {
            if (registeredId) return configure(registeredId, null);
        }).catch(() => undefined);
    });
}
