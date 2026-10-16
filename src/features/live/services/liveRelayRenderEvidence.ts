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

type PaintListener = (entry: ImagePaint) => void;
interface DocumentPaints {
    observer: PerformanceObserver;
    listeners: Map<Element, PaintListener>;
}
const documentPaints = new WeakMap<Document, DocumentPaints>();

/** One observer per document routes each entry once, without retaining paint history. */
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
    let hub: DocumentPaints | undefined;
    const listener: PaintListener = (entry) => {
        if (!active) return;
        const proof = relayRenderProof(entry, image, current());
        if (proof && proof.renderTimeMs >= validAfterMs) accept(proof);
    };
    const disconnect = () => {
        active = false;
        if (!hub || hub.listeners.get(image) !== listener) return;
        hub.listeners.delete(image);
        if (hub.listeners.size === 0) {
            hub.observer.disconnect();
            documentPaints.delete(image.ownerDocument);
        }
    };
    try {
        hub = documentPaints.get(image.ownerDocument);
        if (!hub) {
            const listeners = new Map<Element, PaintListener>();
            const observer = new Observer((list) => {
                for (const entry of list.getEntries() as ImagePaint[]) {
                    if (entry.element) listeners.get(entry.element)?.(entry);
                }
            });
            hub = { observer, listeners };
            // No buffered entries: a remount must not authenticate an earlier node's paint.
            try { observer.observe({ type: "element" }); }
            catch (error) { observer.disconnect(); throw error; }
            documentPaints.set(image.ownerDocument, hub);
        }
        // A node has one component owner; a duplicate must not replace its subscription.
        if (hub.listeners.has(image)) return { supported: false, disconnect, invalidate };
        hub.listeners.set(image, listener);
        return { supported: true, disconnect, invalidate };
    } catch {
        disconnect();
        return { supported: false, disconnect, invalidate };
    }
}
