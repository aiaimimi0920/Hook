// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { unwrap } from "solid-js/store";
vi.mock("../../src/services/syncService", () => ({ syncService: { performWorkflowSync: vi.fn().mockResolvedValue(undefined), updateBackendRects: vi.fn().mockResolvedValue(undefined) } }));
import { StickerAnnotationLayer } from "../../src/components/StickerAnnotationLayer";
import { StickerTopStrip } from "../../src/components/StickerTopStrip";
import { graphStore } from "../../src/store/graphStore";
import { setSelectedStickerId, stickerEditHistories, uiActions } from "../../src/store/uiStore";
import { captureStickerEditSnapshot } from "../../src/services/stickerHistory";
import type { StickerLineAnnotation } from "../../src/types/stickerEditing";
import type { Unit } from "../../src/types/unit";

const id = "paintbrush-interaction";
let dispose: () => void;
let host: HTMLElement;
let frames: Map<number, FrameRequestCallback>;
const paintFrame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); };
const unit = () => graphStore.units.find((item) => item.id === id)!;
const line = () => unit().data.annotationState!.elements[0] as StickerLineAnnotation;
const event = (type: string, x: number, y: number) => host.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y }));
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
    frames = new Map();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const fixture: Unit = { id, type: "sticker", x: 0, y: 0, w: 600, h: 400, params: {}, inputs: [], outputs: [], data: { annotationState: { elements: [], serialCounter: 1 } } };
    graphStore.actions.addUnit(fixture);
    setSelectedStickerId(id);
    uiActions.setActiveStickerEditTarget(id);
    uiActions.setSelectedStickerAnnotation(null);
    uiActions.clearStickerHistory(id);
    uiActions.setStickerEditMode("paintbrush");
    uiActions.patchStickerToolSettings({ strokeWidth: 20, brushOpacity: 0.5, brushSmoothing: 70 });
    const container = document.createElement("div");
    document.body.append(container);
    dispose = render(() => <><StickerAnnotationLayer unitId={id} width={600} height={400} /><StickerTopStrip unitId={id} x={0} y={100} stickerWidth={600} stickerHeight={400} /></>, container);
    host = container.querySelector("[data-sticker-interaction-root]")!;
    host.setPointerCapture = vi.fn();
    host.releasePointerCapture = vi.fn();
});
afterEach(() => { dispose(); graphStore.actions.removeUnit(id); uiActions.clearStickerHistory(id); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

describe("real pencil and paintbrush input", () => {
    it("keeps the beginning fixed and saves all samples after a long gesture crosses 2048 points", async () => {
        event("pointerdown", 20, 200);
        let firstPath: Element | null = null;
        let fixedGeometry: string | null = null;
        for (let i = 1; i <= 2600; i++) {
            event("pointermove", 20 + i % 500, 200 + 20 * Math.sin(i / 12));
            if (i % 32 === 0) paintFrame();
            if (i === 2016) {
                firstPath = host.querySelector('[data-freehand-stroke="paintbrush"] path');
                fixedGeometry = firstPath!.getAttribute("d");
            }
        }
        paintFrame();
        expect(host.querySelector('[data-freehand-stroke="paintbrush"] path')).toBe(firstPath);
        expect(firstPath!.getAttribute("d")).toBe(fixedGeometry);
        event("pointerup", 120, 200 + 20 * Math.sin(2600 / 12)); await settle();
        expect(line().points).toHaveLength(2601);
        expect(line().style.brushWeights).toHaveLength(2601);
        expect(stickerEditHistories[id].past).toHaveLength(1);
    });
    it("keeps old strokes unchanged and commits the latest endpoint after repeated drawing", async () => {
        for (let stroke = 0; stroke < 20; stroke++) {
            event("pointerdown", 20, 20 + stroke * 10);
            event("pointermove", 100, 25 + stroke * 10);
            event("pointerup", 200, 20 + stroke * 10);
            await settle();
        }
        const oldPaths = Array.from(host.querySelectorAll('[data-freehand-stroke="paintbrush"] path'));
        const oldGeometry = oldPaths.map((path) => path.getAttribute("d"));
        event("pointerdown", 20, 300);
        for (let i = 1; i <= 500; i++) event("pointermove", 20 + i * 0.8, 300);
        expect(unit().data.annotationState!.elements).toHaveLength(20);
        paintFrame();
        expect(oldPaths.every((path) => path.isConnected)).toBe(true);
        expect(oldPaths.map((path) => path.getAttribute("d"))).toEqual(oldGeometry);
        event("pointerup", 430, 310); await settle();
        const latest = unit().data.annotationState!.elements.at(-1) as StickerLineAnnotation;
        expect(latest.points.at(-1)).toEqual({ x: 430, y: 310 });
        expect(unit().data.annotationState!.elements).toHaveLength(21);
        expect(frames.size).toBe(0);
    });
    it("reuses live SVG nodes while keeping the newest point under the pointer", () => {
        event("pointerdown", 20, 50);
        const group = host.querySelector('[data-freehand-stroke="paintbrush"]')!;
        const paths = Array.from(group.querySelectorAll("path"));
        const before = paths[0].getAttribute("d");
        for (let i = 1; i <= 60; i++) event("pointermove", 20 + i * 5, 50 + i);
        expect(paths[0].getAttribute("d")).toBe(before);
        paintFrame();
        expect(host.querySelector('[data-freehand-stroke="paintbrush"]')).toBe(group);
        expect(Array.from(group.querySelectorAll("path"))).toEqual(paths);
        expect(paths[0].getAttribute("d")).not.toBe(before);
        expect(paths[0].getAttribute("d")).toContain("110");
        expect(unit().data.annotationState!.elements).toHaveLength(0);
    });
    it("draws a live tapered stroke with matching committed geometry and one history entry", async () => {
        event("pointerdown", 20, 50); event("pointermove", 80, 100); event("pointermove", 200, 50);
        paintFrame();
        expect(unit().data.annotationState!.elements).toHaveLength(0);
        const draft = host.querySelector('[data-freehand-stroke="paintbrush"]')!;
        const draftPath = draft.innerHTML;
        expect(draft.querySelectorAll("path")).toHaveLength(4);
        event("pointerup", 200, 50); await settle();
        expect(line().type).toBe("brush");
        expect(line().style).toMatchObject({ brushTip: "tapered", width: 20, opacity: 0.5 });
        expect(line().style.brushWeights).toHaveLength(line().points.length);
        expect(line().points[0]).not.toHaveProperty("sampleTime");
        expect(host.querySelector('[data-freehand-stroke="paintbrush"]')?.innerHTML).toBe(draftPath);
        expect(stickerEditHistories[id].past).toHaveLength(1);
        const before = structuredClone(unwrap(line()));
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.undoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect(unit().data.annotationState!.elements).toHaveLength(0);
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.redoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect(line()).toEqual(before);
    });
    it("supports a single brush dab and cancellation without partial persistence", async () => {
        event("pointerdown", 20, 50); event("pointermove", 200, 50); event("pointercancel", 200, 50); await settle();
        expect(unit().data.annotationState!.elements).toHaveLength(0);
        event("pointerdown", 30, 60); event("pointerup", 30, 60); await settle();
        expect(line().points).toHaveLength(1);
        expect(host.querySelector('[data-freehand-stroke="paintbrush"] path')?.getAttribute("d")).toContain("a 10 10");
    });
    it("renders compact fields and preserves ordinary pencil and highlighter behavior", async () => {
        expect(document.querySelector('[aria-label="粗细"]')).not.toBeNull();
        expect(document.querySelector('[aria-label="平滑度"]')).not.toBeNull();
        expect(document.querySelector('[aria-label="不透明度"]')).not.toBeNull();
        uiActions.setStickerEditMode("brush");
        uiActions.patchStickerToolSettings({ strokeWidth: 3, brushHighlighterEnabled: false, brushOpacity: 0.75, brushSmoothing: 0 });
        event("pointerdown", 20, 50); event("pointermove", 200, 50); event("pointerup", 200, 50); await settle();
        expect(line().style.brushTip).toBeUndefined();
        expect(line().style.opacity).toBe(0.75);
        expect(host.querySelector('[data-freehand-stroke="pencil"]')?.getAttribute("fill")).toBe("none");
        uiActions.patchStickerToolSettings({ brushHighlighterEnabled: true, brushSmoothing: 100 });
        expect(document.querySelector('[aria-label="平滑度"]')).not.toBeNull();
        expect(document.querySelector('[aria-label="不透明度"]')).not.toBeNull();
        event("pointerdown", 20, 80); event("pointermove", 100, 160); event("pointerup", 200, 80); await settle();
        expect(unit().data.annotationState!.elements[1].type).toBe("highlighter");
        const highlighted = unit().data.annotationState!.elements[1] as StickerLineAnnotation;
        expect(highlighted.style.opacity).toBeCloseTo(0.35 * 0.75);
        expect(highlighted.points[1].y).toBeLessThan(160);
        expect(Number(host.querySelector(`[data-sticker-annotation-id="${highlighted.id}"] path`)?.getAttribute("opacity"))).toBeCloseTo(0.75);
    });
});
