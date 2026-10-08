// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { LiveRelayImage } from "../../src/components/LiveRelayImage";
import { liveRelayDiagnostic } from "../../src/services/liveRelayDiagnostics";
import { observeRelayImage, relayRenderProof, RELAY_ELEMENT_TIMING } from "../../src/services/liveRelayRenderEvidence";
import { liveRelayActions, liveRelayViews } from "../../src/store/liveRelayStore";
import { relayStatus } from "../fixtures/liveRelay";
import type { LiveRelayFrameDescriptor } from "../../src/services/liveRelay";
import type { LiveRelayPresentation } from "../../src/services/liveRelayPresentation";

const presentation: LiveRelayPresentation = {
    liveSessionId: "live:a", epoch: 1, frameId: 7, generation: 2, evidence: "decoded_submitted", codec: "jpeg",
    payloadBytes: 128, imageBytes: 128, readMs: 2, prepareMs: 1, decodeMs: 3, submittedAtMs: 100,
    captureTimestampMs: 200, encodeTimestampMs: 201, receivedTimestampMs: 300,
};
const frame: LiveRelayFrameDescriptor = {
    relayId: "relay:a", liveSessionId: "live:a", epoch: 1, frameId: 7, codec: "jpeg", width: 4, height: 4,
    colorSpace: "srgb", byteLength: 128, captureTimestampMs: 200, encodeTimestampMs: 201,
    receivedTimestampMs: 300, droppedFrames: 0,
};
let unmount: (() => void) | undefined;
let image: HTMLImageElement;
let observers: FakeObserver[];
class FakeObserver {
    static supportedEntryTypes = ["element"];
    disconnected = false;
    observe = vi.fn();
    constructor(private callback: PerformanceObserverCallback) { observers.push(this); }
    disconnect() { this.disconnected = true; }
    emit(entry: Parameters<typeof relayRenderProof>[0]) {
        this.callback({ getEntries: () => [entry] } as PerformanceObserverEntryList, this as unknown as PerformanceObserver);
    }
}
const paint = () => ({
    name: "image-paint", entryType: "element", startTime: 150, duration: 0, toJSON: () => ({}),
    identifier: RELAY_ELEMENT_TIMING, element: image, url: "blob:frame", renderTime: 150,
    intersectionRect: new DOMRect(0, 0, 4, 4),
});
beforeEach(() => {
    observers = [];
    vi.stubGlobal("PerformanceObserver", FakeObserver);
    vi.spyOn(performance, "now").mockReturnValue(1000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    liveRelayActions.clear();
    liveRelayActions.add({ ...relayStatus }, "private-title", { x: 0, y: 0, width: 320, height: 240 });
    liveRelayActions.updateFrame("relay:a", "blob:frame", frame, presentation);
    unmount = render(() => <LiveRelayImage view={liveRelayViews[0]} />, document.body);
    image = document.querySelector("img")!;
    Object.defineProperties(image, { complete: { configurable: true, value: true },
        naturalWidth: { configurable: true, value: 4 }, naturalHeight: { configurable: true, value: 4 } });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 4, 4));
});
afterEach(() => {
    unmount?.(); unmount = undefined;
    liveRelayActions.clear(); document.body.replaceChildren();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("records only the actual mounted node's current paint as a separate evidence tier", () => {
    expect(image.getAttribute("elementtiming")).toBe(RELAY_ELEMENT_TIMING);
    expect(observers[0].observe).toHaveBeenCalledWith({ type: "element" });
    expect(liveRelayDiagnostic(liveRelayViews[0]).rendering).toBeNull();
    observers[0].emit(paint());
    const diagnostic = liveRelayDiagnostic(liveRelayViews[0]);
    expect(diagnostic.presentation?.evidence).toBe("decoded_submitted");
    expect(diagnostic.rendering).toEqual({ evidence: "browser_element_render", generation: 2,
        frameId: 7, renderTimeMs: 150, sinceSubmittedMs: 50 });
    expect(JSON.stringify(diagnostic)).not.toContain("blob:");
    expect(JSON.stringify(diagnostic)).not.toContain("private-title");
});

it.each(["node", "url", "identifier", "type", "zero-time", "old-time", "future-time", "infinite", "empty-intersection"])(
    "rejects invalid or stale browser evidence: %s", reason => {
        const entry = paint();
        if (reason === "node") entry.element = document.createElement("img");
        if (reason === "url") entry.url = "blob:old";
        if (reason === "identifier") entry.identifier = "other";
        if (reason === "type") entry.entryType = "resource";
        if (reason === "zero-time") entry.renderTime = 0;
        if (reason === "old-time") entry.renderTime = 99;
        if (reason === "future-time") entry.renderTime = 1001;
        if (reason === "infinite") entry.renderTime = Infinity;
        if (reason === "empty-intersection") entry.intersectionRect = new DOMRect();
        observers[0].emit(entry);
        expect(liveRelayViews[0].renderProof).toBeUndefined();
    },
);

it.each(["hidden", "css-hidden", "broken", "dimension", "detached", "closed", "epoch", "generation"])(
    "rejects non-current or non-visible target: %s", reason => {
        if (reason === "hidden") vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        if (reason === "css-hidden") image.style.visibility = "hidden";
        if (reason === "broken") Object.defineProperty(image, "complete", { value: false });
        if (reason === "dimension") Object.defineProperty(image, "naturalWidth", { value: 5 });
        if (reason === "detached") image.remove();
        if (reason === "closed") liveRelayActions.updateStatus("relay:a", { ...relayStatus, connectionState: "closed" });
        if (reason === "epoch") liveRelayActions.updateStatus("relay:a", { ...relayStatus, epoch: 2 });
        if (reason === "generation") liveRelayActions.updateFrame("relay:a", "blob:frame", frame, { ...presentation, generation: 0 });
        expect(relayRenderProof(paint(), image, liveRelayViews[0])).toBeUndefined();
    },
);

it("clears the proof on replacement and rejects a queued old-URL paint", () => {
    const old = paint(); observers[0].emit(old);
    liveRelayActions.updateFrame("relay:a", "blob:next", { ...frame, frameId: 8 }, { ...presentation, frameId: 8 });
    expect(liveRelayViews[0].renderProof).toBeUndefined();
    observers[0].emit(old);
    expect(liveRelayDiagnostic(liveRelayViews[0]).rendering).toBeNull();
    const next = { ...paint(), url: "blob:next" }; observers[0].emit(next);
    expect(liveRelayViews[0].renderProof?.frameId).toBe(8);
});

it("invalidates hidden/error evidence and rejects callbacks after unmount", () => {
    observers[0].emit(paint()); document.dispatchEvent(new Event("visibilitychange"));
    expect(liveRelayViews[0].renderProof).toBeUndefined();
    observers[0].emit(paint()); image.dispatchEvent(new Event("error"));
    expect(liveRelayViews[0].renderProof).toBeUndefined();
    const old = paint(); unmount?.(); unmount = undefined;
    expect(observers[0].disconnected).toBe(true);
    observers[0].emit(old);
    expect(liveRelayViews[0].renderProof).toBeUndefined();
});

it("does not reauthenticate a queued pre-hide paint after becoming visible again", () => {
    const old = paint(); observers[0].emit(old);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    observers[0].emit(old);
    expect(liveRelayViews[0].renderProof).toBeUndefined();
    vi.spyOn(performance, "now").mockReturnValue(1200);
    observers[0].emit({ ...paint(), renderTime: 1100 });
    expect(liveRelayViews[0].renderProof?.renderTimeMs).toBe(1100);
});

it("fails closed when Element Timing is absent or observer registration fails", () => {
    unmount?.(); unmount = undefined;
    vi.stubGlobal("PerformanceObserver", undefined);
    const accept = vi.fn();
    expect(observeRelayImage(image, () => liveRelayViews[0], accept).supported).toBe(false);
    vi.stubGlobal("PerformanceObserver", FakeObserver);
    vi.spyOn(FakeObserver.prototype, "disconnect");
    class BrokenObserver extends FakeObserver { observe = vi.fn(() => { throw new Error("unsupported"); }); }
    vi.stubGlobal("PerformanceObserver", BrokenObserver);
    expect(observeRelayImage(image, () => liveRelayViews[0], accept).supported).toBe(false);
    expect(observers.at(-1)?.disconnected).toBe(true);
    class BrokenConstructor { static supportedEntryTypes = ["element"]; constructor() { throw new Error("unavailable"); } }
    vi.stubGlobal("PerformanceObserver", BrokenConstructor);
    expect(observeRelayImage(image, () => liveRelayViews[0], accept).supported).toBe(false);
    expect(accept).not.toHaveBeenCalled();
});

it("clears support when the current image is cleared or unmounted", () => {
    expect(liveRelayDiagnostic(liveRelayViews[0]).renderEvidenceSupported).toBe(true);
    liveRelayActions.clearFrame("relay:a");
    expect(liveRelayDiagnostic(liveRelayViews[0]).renderEvidenceSupported).toBeNull();
    liveRelayActions.setRenderEvidenceSupport("relay:a", false);
    unmount?.(); unmount = undefined;
    expect(liveRelayDiagnostic(liveRelayViews[0]).renderEvidenceSupported).toBeNull();
});

it("routes document paints only to their owner and disconnects after the last image", () => {
    const other = document.createElement("img");
    const current = vi.fn(() => liveRelayViews[0]);
    const accept = vi.fn();
    const subscription = observeRelayImage(other, current, accept);
    expect(subscription.supported).toBe(true);
    expect(observers).toHaveLength(1);
    const entry = paint();
    observers[0].emit(entry);
    expect(current).not.toHaveBeenCalled();
    expect(liveRelayViews[0].renderProof?.frameId).toBe(7);
    unmount?.(); unmount = undefined;
    expect(observers[0].disconnected).toBe(false);
    observers[0].emit(entry);
    expect(current).not.toHaveBeenCalled();
    subscription.disconnect();
    expect(observers[0].disconnected).toBe(true);
    observers[0].emit({ ...entry, element: other });
    expect(current).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
});
