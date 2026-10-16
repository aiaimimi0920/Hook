// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { unwrap } from "solid-js/store";
import { createRoot } from "solid-js";
vi.mock("../../src/features/workspace/services/syncService", () => ({ syncService: { performWorkflowSync: vi.fn().mockResolvedValue(undefined), updateBackendRects: vi.fn().mockResolvedValue(undefined) } }));
import { StickerAnnotationLayer } from "../../src/features/stickers/components/StickerAnnotationLayer";
import { StickerTopStrip } from "../../src/features/stickers/components/StickerTopStrip";
import { createSelectedLineProperties } from "../../src/features/stickers/components/stickerSelectedLineProperties";
import { graphStore } from "../../src/features/workspace/state/graphStore";
import { selectedStickerAnnotationId, setSelectedStickerId, stickerEditHistories, uiActions } from "../../src/features/workspace/state/uiStore";
import { captureStickerEditSnapshot } from "../../src/features/stickers/services/stickerHistory";
import { createOverlaySyntheticDispatcher } from "../../src/platform/desktop/overlaySyntheticEvents";
import { splitBezierSegment } from "../../src/features/stickers/services/stickerBezierSubdivision";
import { extraRects } from "../../src/platform/desktop/uiRegistry";
import type { StickerLineAnnotation } from "../../src/features/stickers/types/stickerEditing";
import type { Unit } from "../../src/features/workspace/types/unit";

const id = "bezier-interaction";
let dispose: () => void;
let host: HTMLElement;
const unit = () => graphStore.units.find((item) => item.id === id)!;
const line = () => unit().data.annotationState!.elements[0] as StickerLineAnnotation;
const historyLength = () => stickerEditHistories[id]?.past.length ?? 0;
const event = (type: string, x: number, y: number, target: Element = host) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y }));
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
async function draw() {
    event("pointerdown", 30, 50);
    event("pointermove", 330, 50);
    event("pointerup", 330, 50);
    await settle();
}

beforeEach(() => {
    const fixture: Unit = { id, type: "sticker", x: 0, y: 0, w: 600, h: 400, params: {}, inputs: [], outputs: [],
        data: { annotationState: { elements: [], serialCounter: 1 } } };
    graphStore.actions.addUnit(fixture);
    setSelectedStickerId(id);
    uiActions.setActiveStickerEditTarget(id);
    uiActions.setSelectedStickerAnnotation(null);
    uiActions.clearStickerHistory(id);
    uiActions.setStickerEditMode("bezier");
    const container = document.createElement("div");
    document.body.append(container);
    dispose = render(() => <StickerAnnotationLayer unitId={id} width={600} height={400} />, container);
    host = container.querySelector("[data-sticker-interaction-root]")!;
    host.setPointerCapture = vi.fn();
    host.releasePointerCapture = vi.fn();
});
afterEach(() => {
    dispose();
    graphStore.actions.removeUnit(id);
    uiActions.clearStickerHistory(id);
    document.body.innerHTML = "";
});

describe("real annotation layer cubic gestures", () => {
    it("deletes a node through native right-click routing and supports undo/redo", async () => {
        await draw();
        const split = { ...unwrap(line()), points: splitBezierSegment(line().points, 0, 0.5) };
        graphStore.actions.updateUnitData(id, { annotationState: { elements: [split], serialCounter: 1 } });
        const before = structuredClone(unwrap(line()));
        const historyBefore = historyLength();
        const dispatcher = createOverlaySyntheticDispatcher({ doc: document, elementFromPoint: () => host, isLinking: () => false, getDraggingStickerId: () => null });
        dispatcher.dispatch("contextmenu", { x: before.points[3].x, y: before.points[3].y });
        await settle();
        const menu = document.querySelector('[role="menu"][aria-label="贝塞尔节点"]');
        expect(menu).not.toBeNull();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        expect(extraRects().find((rect) => rect.id === `sticker-bezier-node-menu-${id}`)?.name).toBe("STICKER_CONTEXT_MENU_ROOT");
        expect(line()).toEqual(before);
        (menu!.querySelector("button") as HTMLButtonElement).click();
        await settle();
        expect(line().points).toHaveLength(4);
        expect(line().id).toBe(before.id);
        expect(historyLength()).toBe(historyBefore + 1);
        expect(document.querySelector('[aria-label="贝塞尔节点"]')).toBeNull();
        expect(extraRects().some((rect) => rect.id === `sticker-bezier-node-menu-${id}`)).toBe(false);
        const after = structuredClone(unwrap(line()));
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.undoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect(line()).toEqual(before);
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.redoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect(line()).toEqual(after);
    });

    it("guards the final segment and ignores control handles; right-click never starts a drag", async () => {
        await draw();
        const before = structuredClone(unwrap(line()));
        const start = host.querySelector('[data-bezier-handle="start"]')!;
        start.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2, clientX: 30, clientY: 50 }));
        host.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 50 }));
        await settle();
        expect(document.querySelector<HTMLButtonElement>('[role="menuitem"]')?.disabled).toBe(true);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(document.querySelector('[aria-label="贝塞尔节点"]')).toBeNull();
        const c = before.points[1];
        host.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: c.x, clientY: c.y }));
        expect(document.querySelector('[aria-label="贝塞尔节点"]')).toBeNull();
        event("pointermove", 100, 200); event("pointerup", 100, 200); await settle();
        expect(line()).toEqual(before);
        expect(historyLength()).toBe(1);
    });
    it("creates and selects a cubic, reshapes through native-style root routing, and undoes/redoes once", async () => {
        await draw();
        expect(line().type).toBe("bezier");
        expect(line().points).toHaveLength(4);
        expect(selectedStickerAnnotationId()).toBe(line().id);
        expect(host.querySelectorAll("[data-bezier-handle]")).toHaveLength(4);
        expect(historyLength()).toBe(1);
        const before = structuredClone(unwrap(line()));
        let target: Element | null = host.querySelector('[data-bezier-handle="control1"]');
        const dispatcher = createOverlaySyntheticDispatcher({ doc: document, elementFromPoint: () => target, isLinking: () => false, getDraggingStickerId: () => null });
        const control = before.points[1];
        dispatcher.dispatch("mousedown", { x: control.x, y: control.y });
        dispatcher.dispatch("mousemove", { x: control.x + 10, y: control.y + 50 });
        expect(line().points).toEqual(before.points);
        target = null;
        dispatcher.dispatch("mousemove", { x: control.x + 20, y: control.y + 80 });
        dispatcher.dispatch("mouseup", { x: control.x + 20, y: control.y + 80 });
        await settle();
        expect(line().points[1]).toEqual({ x: control.x + 20, y: control.y + 80 });
        expect(historyLength()).toBe(2);
        const after = structuredClone(unwrap(line()));
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.undoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect(line()).toEqual(before);
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.redoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect(line()).toEqual(after);
    });

    it("can deselect/reselect, edit both tangents and endpoints without losing the cubic", async () => {
        await draw();
        event("pointerdown", 550, 350); event("pointerup", 550, 350); await settle();
        expect(selectedStickerAnnotationId()).toBeNull();
        event("pointerdown", 30, 50); event("pointerup", 30, 50); await settle();
        expect(selectedStickerAnnotationId()).toBe(line().id);
        for (const handle of ["control2", "start", "end"]) {
            const circle = host.querySelector(`[data-bezier-handle="${handle}"]`)!;
            const x = Number(circle.getAttribute("cx")), y = Number(circle.getAttribute("cy"));
            event("pointerdown", x, y, circle); event("pointermove", x + 10, y + 20); event("pointerup", x + 10, y + 20);
            await settle();
        }
        expect(line().points[0]).toEqual({ x: 40, y: 70 });
        expect(line().points[3]).toEqual({ x: 340, y: 70 });
        expect(line().type).toBe("bezier");
    });

    it("cancels draft/handle edits without persisting a partial curve", async () => {
        event("pointerdown", 30, 50); event("pointermove", 330, 50); event("pointercancel", 330, 50);
        await settle();
        expect(unit().data.annotationState!.elements).toHaveLength(0);
        await draw();
        const before = structuredClone(unwrap(line()));
        const c = before.points[1];
        event("pointerdown", c.x, c.y); event("pointermove", 50, 200);
        uiActions.requestStickerEditCancel();
        event("pointerup", 50, 200); await settle();
        expect(line()).toEqual(before);
        expect(historyLength()).toBe(1);
    });

    it("edits selected stroke properties with history without modifying control points", async () => {
        await draw();
        const originalPoints = structuredClone(unwrap(line().points));
        createRoot((disposeProperties) => {
            const properties = createSelectedLineProperties(() => id, () => true);
            properties.patch({ strokeWidth: 12, lineStrokeColor: "#22c55e80", lineArrowEnabled: true, shapeStrokeDashPattern: "dash-2" });
            disposeProperties();
        });
        expect(line().style).toMatchObject({ width: 12, color: "#22c55e80", dashPattern: "dash-2" });
        expect(line().showArrowHead).toBe(true);
        expect(line().points).toEqual(originalPoints);
        expect(historyLength()).toBe(2);
    });

    it("unmounts selected curve properties safely when rasterization removes the vector", async () => {
        const toolbarHost = document.createElement("div");
        document.body.append(toolbarHost);
        const stopToolbar = render(() => <StickerTopStrip unitId={id} x={20} y={150} stickerWidth={600} stickerHeight={400} />, toolbarHost);
        try {
            await draw();
            expect(document.querySelector('[aria-label="描边颜色"]')).not.toBeNull();
            expect(() => graphStore.actions.updateUnitData(id, { annotationState: { elements: [], serialCounter: 1 } })).not.toThrow();
            expect(document.querySelector('[aria-label="描边颜色"]')).toBeNull();
        } finally { stopToolbar(); }
    });

    it("inserts nodes and extends the same path through stable native-style root events", async () => {
        await draw();
        const annotationId = line().id;
        // Recreated selection highlights must not become the browser's click target.
        const highlight = host.querySelector<SVGPathElement>('[data-sticker-annotation-selection-overlay] path');
        expect(highlight?.style.pointerEvents).toBe("none");
        // Browsers dispatch dblclick immediately after the second pointerup, before
        // the async release continuation has cleared its single-flight flag.
        event("pointerdown", 180, 106.25); event("pointerup", 180, 106.25);
        host.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 180, clientY: 106.25 }));
        await settle();
        expect(line().points).toHaveLength(7);
        expect(host.querySelectorAll("[data-bezier-handle]")).toHaveLength(7);
        for (const end of [{ x: 460, y: 180 }, { x: 550, y: 280 }]) {
            const handle = host.querySelector('[data-bezier-extend="extend-end"]')!;
            const x = Number(handle.getAttribute("cx")), y = Number(handle.getAttribute("cy"));
            const previous = structuredClone(unwrap(line().points));
            event("pointerdown", x, y); event("pointermove", end.x, end.y);
            expect(line().points).toEqual(previous);
            event("pointerup", end.x, end.y); await settle();
            expect(line().points.slice(0, previous.length)).toEqual(previous);
            expect(line().points.at(-1)).toEqual(end);
            expect(line().id).toBe(annotationId);
        }
        expect(line().points).toHaveLength(13);
        expect(historyLength()).toBe(4);
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.undoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect(line().points).toHaveLength(10);
    });
});
