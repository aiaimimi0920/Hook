// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { batch } from "solid-js";
import { render } from "solid-js/web";
import { reconcile } from "solid-js/store";

vi.mock("../../src/services/api", () => ({
    api: { debugLogEvent: vi.fn() },
    isTauriRuntimeAvailable: () => false,
}));

import { CanvasLinks } from "../../src/components/CanvasLinks";
import { graphStore } from "../../src/store/graphStore";
import {
    setHoveringLink, setIsCleanView, setLayoutTick, setLinkingState,
    setMultiDragPositions, setSelectedStickerId, setUnitUiState,
} from "../../src/store/uiStore";
import { updatePortOffset } from "../../src/services/uiRegistry";
import type { Link, Unit } from "../../src/types/unit";
import { setUnitChromeMode } from "../../src/store/unitChromeState";

const unit = (id: string, x = 0, y = 0): Unit => ({
    id, type: "sticker", x, y, w: 100, h: 80,
    params: {}, inputs: [], outputs: [], data: {},
});
const link = (id: string, fromUnitId = "from", toUnitId = "to"): Link => ({
    id, fromUnitId, toUnitId, fromPortId: "output_image", toPortId: "input_image",
});
const setPanel = (id: string, showParams: boolean) =>
    setUnitUiState(id, { showActions: false, showParams });

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
const paths = () => Array.from(container.querySelectorAll<SVGPathElement>(
    'path[stroke="var(--theme-signal)"]',
));
const mount = () => { dispose = render(() => <CanvasLinks />, container); };

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    batch(() => {
        graphStore.setUnits([unit("from", 10, 20), unit("to", 300, 100)]);
        graphStore.setLinks([link("edge")]);
        graphStore.setCapabilities([]);
        graphStore.setUnitParams(reconcile({}));
        setUnitUiState(reconcile({}));
        setMultiDragPositions(null);
        setSelectedStickerId(null);
        setHoveringLink({ sourceUnitId: null, targetUnitId: null });
        setLinkingState((previous) => ({ ...previous, isLinking: false }));
        setIsCleanView(false);
    });
});

afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    vi.restoreAllMocks();
});

describe("CanvasLinks DOM ownership", () => {
    it("hides reference lines with endpoints in both global hidden modes and restores after Tab expansion", () => {
        mount();
        expect(paths()).toHaveLength(1);
        for (const mode of ["border", "none"] as const) {
            setUnitChromeMode(mode);
            expect(paths()).toHaveLength(0);
            setPanel("from", true);
            expect(paths()).toHaveLength(0);
            setPanel("to", true);
            expect(paths().length).toBeGreaterThan(0);
            setPanel("from", false); setPanel("to", false);
            expect(paths()).toHaveLength(0);
        }
        setUnitChromeMode("all");
        expect(paths()).toHaveLength(1);
    });

    it("honors per-unit endpoint visibility for completed links, highlights and drag previews", () => {
        graphStore.setUnitParams("from", { image: "to" });
        setSelectedStickerId("from");
        setHoveringLink({ sourceUnitId: "from", targetUnitId: "to" });
        setLinkingState({ isLinking: true, sourceUnitId: "from", sourceParamId: "output_image", startX: 111, startY: 56 });
        mount();
        expect(container.querySelectorAll("path, line, rect").length).toBeGreaterThan(0);
        graphStore.setUnits(0, "data", "hideCollapsedEndpoints", true);
        expect(container.querySelectorAll("path, line, rect")).toHaveLength(0);
        setPanel("from", true);
        expect(container.querySelectorAll("path, line, rect").length).toBeGreaterThan(0);
        setPanel("from", false);
        expect(container.querySelectorAll("path, line, rect")).toHaveLength(0);
        graphStore.setUnits(0, "data", "hideCollapsedEndpoints", false);
        expect(container.querySelectorAll("path, line, rect").length).toBeGreaterThan(0);
    });
    it("uses theme signal yellow for the drag preview, completed connection and arrowhead", () => {
        setLinkingState({ isLinking: true, sourceUnitId: "from", sourceParamId: "output_image", startX: 111, startY: 56 });
        mount();
        expect(paths()).toHaveLength(2);
        expect(paths()[0].getAttribute("d")).toMatch(/^M 111 56 C /);
        expect(container.querySelector("marker polygon")?.getAttribute("fill")).toBe("var(--theme-signal)");
    });
    it("updates dragged, committed, resized, and minified geometry on the same path", () => {
        mount();
        const body = paths()[0];
        expect(body.getAttribute("d")).toBe("M 111 56 C 161 56, 249 136, 299 136");
        setMultiDragPositions({ from: { x: 40, y: 60 } });
        expect(paths()[0]).toBe(body);
        expect(body.getAttribute("d")).toBe("M 141 96 C 191 96, 249 136, 299 136");
        batch(() => {
            graphStore.setUnits(0, { x: 50, y: 70, w: 120 });
            setMultiDragPositions(null);
        });
        expect(paths()[0]).toBe(body);
        expect(body.getAttribute("d")).toBe("M 171 106 C 221 106, 249 136, 299 136");
        graphStore.setUnits(0, "data", "minified", true);
        expect(paths()[0]).toBe(body);
        expect(body.getAttribute("d")).toBe("M 174 110 C 224 110, 249 136, 299 136");
        setLayoutTick((tick) => tick + 1);
        expect(paths()[0]).toBe(body);
    });

    it("preserves body/panel visibility, offsets, fallback, and clean-view rules", () => {
        mount();
        const body = paths()[0];
        setPanel("from", true);
        const dashed = paths()[1];
        expect(dashed.getAttribute("stroke-dasharray")).toBe("5,5");
        expect(dashed.getAttribute("d")).toBe(body.getAttribute("d"));
        updatePortOffset("from", "output_image", { x: 150, y: 90 });
        expect(paths()[0]).toBe(body);
        expect(paths()[1]).toBe(dashed);
        expect(dashed.getAttribute("d")).toBe("M 160 110 C 210 110, 249 136, 299 136");
        setIsCleanView(true);
        expect(paths()).toHaveLength(0);
        setPanel("to", true);
        updatePortOffset("to", "input_image", { x: -30, y: 80 });
        const cleanDashed = paths()[0];
        expect(paths()).toHaveLength(1);
        expect(cleanDashed.getAttribute("d")).toBe("M 160 110 C 210 110, 220 180, 270 180");
        setMultiDragPositions({ to: { x: 400, y: 200 } });
        expect(paths()[0]).toBe(cleanDashed);
        expect(cleanDashed.getAttribute("d")).toBe("M 160 110 C 210 110, 320 280, 370 280");
        setIsCleanView(false);
        expect(paths()[1]).toBe(cleanDashed);
        graphStore.setUnits(0, "data", "minified", true);
        expect(paths()).toHaveLength(2);
        expect(paths()[1]).toBe(cleanDashed);
        setIsCleanView(true);
        expect(paths()).toHaveLength(0);
    });

    it("tracks capability port order and changed port IDs without remounting", () => {
        graphStore.setUnits(0, { type: "art", artId: "test-art" });
        graphStore.setLinks(0, "fromPortId", "secondary");
        const primary = { name: "primary", label: "Primary", type: "image" };
        const secondary = { name: "secondary", label: "Secondary", type: "image" };
        graphStore.setCapabilities([{
            id: "test-art", label: "Test Art", description: "Port layout test",
            supported_transports: [], execution: { type: "framework_art" },
            params: [], inputs: [], outputs: [primary, secondary],
        }]);
        mount();
        const body = paths()[0];
        expect(body.getAttribute("d")).toBe("M 111 92 C 161 92, 249 136, 299 136");
        graphStore.setCapabilities(0, "outputs", [secondary, primary]);
        expect(paths()[0]).toBe(body);
        expect(body.getAttribute("d")).toBe("M 111 56 C 161 56, 249 136, 299 136");
        graphStore.setLinks(0, "fromPortId", "primary");
        expect(paths()[0]).toBe(body);
        expect(body.getAttribute("d")).toBe("M 111 92 C 161 92, 249 136, 299 136");
    });

    it("retains keyed paths on link replacement/reorder and cleans removed endpoints", () => {
        graphStore.setUnits((previous) => [...previous, unit("third", 500, 200)]);
        graphStore.setLinks([link("first"), link("second", "to", "third")]);
        mount();
        const [first, second] = paths();
        graphStore.setLinks([link("second", "to", "third"), link("first")]);
        expect(paths()[0]).toBe(second);
        expect(paths()[1]).toBe(first);
        graphStore.setLinks(1, "toUnitId", "third");
        expect(paths()[1]).toBe(first);
        expect(first.getAttribute("d")).toContain("499 236");
        graphStore.setLinks((previous) => [previous[1]]);
        expect(paths()).toHaveLength(1);
        expect(paths()[0]).toBe(first);
        expect(second.isConnected).toBe(false);
        graphStore.setUnits((previous) => previous.filter((item) => item.id !== "third"));
        expect(paths()).toHaveLength(0);
        graphStore.setUnits((previous) => [...previous, unit("third", 600, 300)]);
        expect(paths()).toHaveLength(1);
        expect(paths()[0].getAttribute("d")).toContain("599 336");
        dispose?.();
        dispose = undefined;
        expect(container.querySelector("svg")).toBeNull();
        setMultiDragPositions({ from: { x: 999, y: 999 } });
        expect(container.childNodes).toHaveLength(0);
    });

    it("does not allocate SVG nodes or touch unrelated paths over 120 large-canvas drag frames", () => {
        const count = 400;
        graphStore.setUnits(Array.from({ length: count + 1 }, (_, index) => unit(`unit-${index}`, index * 140)));
        graphStore.setLinks(Array.from({ length: count }, (_, index) => link(
            `edge-${index}`, `unit-${index}`, `unit-${index + 1}`,
        )));
        mount();
        const original = paths();
        const observer = new MutationObserver(() => {});
        observer.observe(container, { subtree: true, childList: true, attributes: true });
        const createElement = vi.spyOn(document, "createElementNS");
        const cloneNode = vi.spyOn(Node.prototype, "cloneNode");
        const startedAt = performance.now();
        for (let frame = 1; frame <= 120; frame += 1) {
            setMultiDragPositions({ "unit-0": { x: frame, y: frame } });
        }
        const elapsedMs = performance.now() - startedAt;
        const mutations = observer.takeRecords();
        observer.disconnect();
        const finalPaths = paths();
        expect(finalPaths).toHaveLength(original.length);
        original.forEach((path, index) => expect(finalPaths[index]).toBe(path));
        expect(createElement).not.toHaveBeenCalled();
        expect(cloneNode).not.toHaveBeenCalled();
        expect(mutations.filter((mutation) => mutation.type === "childList")).toHaveLength(0);
        expect(mutations).toHaveLength(120);
        expect(mutations.every((mutation) => mutation.target === original[0] && mutation.attributeName === "d")).toBe(true);
        expect(original[0].getAttribute("d")).toBe("M 221 156 C 271 156, 89 36, 139 36");
        expect(elapsedMs).toBeLessThan(5_000);
    });
});
