import type { LiveRelayView } from "./liveRelay";

export const RELAY_ELEMENT_TIMING = "hook-live-relay-frame";

export interface LiveRelayRenderProof {
    evidence: "browser_element_render";
    relayId: string;
    liveSessionId: string;
    epoch: number;
    frameId: number;
    generation: number;
    renderTimeMs: number;
    sinceSubmittedMs: number;
}

type ImagePaint = PerformanceEntry & {
    identifier?: string;
    element?: Element | null;
    url?: string;
    renderTime?: number;
    intersectionRect?: DOMRectReadOnly;
};

/** Browser image-paint evidence, not compositor acknowledgement or physical display proof. */
export function relayRenderProof(
    entry: ImagePaint,
    image: HTMLImageElement,
    view: LiveRelayView | undefined,
): LiveRelayRenderProof | undefined {
    const submitted = view?.presentation;
    const renderTime = entry.renderTime;
    if (!view || !submitted || !view.imageUrl || view.status.connectionState === "closed"
        || view.relayId !== view.status.relayId || submitted.liveSessionId !== view.status.liveSessionId
        || submitted.epoch !== view.status.epoch || submitted.frameId !== view.submittedFrameId
        || submitted.evidence !== "decoded_submitted"
        || !Number.isSafeInteger(submitted.frameId) || submitted.frameId <= 0
        || !Number.isSafeInteger(submitted.generation) || submitted.generation <= 0
        || !Number.isFinite(submitted.submittedAtMs) || submitted.submittedAtMs < 0
        || entry.entryType !== "element" || entry.name !== "image-paint"
        || entry.identifier !== RELAY_ELEMENT_TIMING || entry.element !== image
        || entry.url !== view.imageUrl || (image.currentSrc || image.src) !== view.imageUrl
        || typeof renderTime !== "number" || !Number.isFinite(renderTime) || renderTime <= 0
        || renderTime < submitted.submittedAtMs || renderTime > performance.now()
        || !image.isConnected || image.ownerDocument.visibilityState !== "visible"
        || !image.complete || image.naturalWidth !== view.frameWidth || image.naturalHeight !== view.frameHeight) {
        return undefined;
    }
    const intersection = entry.intersectionRect;
    const bounds = image.getBoundingClientRect();
    if (!intersection || !Number.isFinite(intersection.width) || !Number.isFinite(intersection.height)
        || intersection.width <= 0 || intersection.height <= 0 || bounds.width <= 0 || bounds.height <= 0
        || image.ownerDocument.defaultView?.getComputedStyle(image).visibility !== "visible") return undefined;
    return {
        evidence: "browser_element_render", relayId: view.relayId,
        liveSessionId: submitted.liveSessionId, epoch: submitted.epoch,
        frameId: submitted.frameId, generation: submitted.generation,
        renderTimeMs: renderTime, sinceSubmittedMs: renderTime - submitted.submittedAtMs,
    };
}

/** One observer per mounted viewer; never retains entries, pixels, URLs or a timer. */
export function observeRelayImage(
    image: HTMLImageElement,
    current: () => LiveRelayView | undefined,
    accept: (proof: LiveRelayRenderProof) => void,
): { supported: boolean; disconnect: () => void; invalidate: () => void } {
    image.setAttribute("elementtiming", RELAY_ELEMENT_TIMING);
    const Observer = image.ownerDocument.defaultView?.PerformanceObserver;
    if (!Observer?.supportedEntryTypes?.includes("element")) return {
        supported: false, disconnect: () => undefined, invalidate: () => undefined,
    };
    let active = true;
    let validAfterMs = 0;
    // Visibility/error invalidation also fences entries queued before the invalidation.
    const invalidate = () => { validAfterMs = performance.now(); };
    let observer: PerformanceObserver | undefined;
    const disconnect = () => { active = false; observer?.disconnect(); };
    try {
        observer = new Observer((list) => {
            if (!active) return;
            for (const entry of list.getEntries()) {
                const proof = relayRenderProof(entry, image, current());
                if (proof && proof.renderTimeMs >= validAfterMs) accept(proof);
            }
        });
        // No buffered entries: a remount must not authenticate an earlier node's paint.
        observer.observe({ type: "element" });
        return { supported: true, disconnect, invalidate };
    } catch {
        disconnect();
        return { supported: false, disconnect, invalidate };
    }
}
