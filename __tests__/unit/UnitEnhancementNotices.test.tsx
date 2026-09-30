// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

import {
    CanvasOverlayLayers,
    type CanvasOverlayLayerRefs,
} from "../../src/components/CanvasOverlayLayers";
import {
    ENHANCEMENT_NOTICE_TIMEOUT_MS,
    UnitEnhancementNotices,
} from "../../src/components/UnitEnhancementNotices";
import {
    clearDragFollowerRegistry,
    getDragFollowerElements,
} from "../../src/services/dragFollowerRegistry";
import { enhancementNotices, uiActions } from "../../src/store/uiStore";

const UNIT_ID = "notice-unit";

describe("UnitEnhancementNotices", () => {
    let dispose: (() => void) | undefined;
    let host: HTMLDivElement;
    let noticesLayer: HTMLDivElement;

    beforeEach(() => {
        uiActions.dismissEnhancementNotice(UNIT_ID);
        clearDragFollowerRegistry();
        host = document.createElement("div");
        noticesLayer = document.createElement("div");
        noticesLayer.dataset.testid = "canvas-notices";
        document.body.append(host);
        document.body.append(noticesLayer);
    });

    afterEach(() => {
        dispose?.();
        host.remove();
        noticesLayer.remove();
        uiActions.dismissEnhancementNotice(UNIT_ID);
        vi.useRealTimers();
        clearDragFollowerRegistry();
    });

    const mount = (onShellClick = () => undefined) => {
        dispose = render(
            () => (
                <div data-testid="unit-shell" style={{ position: "relative" }} onClick={onShellClick}>
                    <div data-testid="clipped-image" style={{ opacity: 0, overflow: "hidden" }} />
                    <UnitEnhancementNotices
                        unitId={UNIT_ID}
                        unitX={100}
                        unitY={50}
                        unitWidth={300}
                        unitHeight={120}
                        noticesLayer={noticesLayer}
                    />
                </div>
            ),
            host,
        );
    };

    it("renders a generated notice in the independent canvas layer at the unit frame", () => {
        mount();

        uiActions.showEnhancementNotice(UNIT_ID, {
            feature: "OCR",
            title: "OCR 文本已复制",
            message: "已复制文本：example",
        });

        const layer = noticesLayer.querySelector<HTMLElement>("[data-hook-unit-notice-layer='true']");
        const anchor = layer?.parentElement;
        expect(enhancementNotices[UNIT_ID]).toHaveLength(1);
        expect(layer).not.toBeNull();
        expect(noticesLayer.contains(anchor ?? null)).toBe(true);
        expect(anchor?.closest("[data-testid='canvas-notices']")).toBe(noticesLayer);
        expect(anchor?.dataset.hookUnitNoticeAnchor).toBe(UNIT_ID);
        expect(anchor?.style.left).toBe("100px");
        expect(anchor?.style.top).toBe("50px");
        expect(anchor?.style.width).toBe("300px");
        expect(anchor?.style.height).toBe("120px");
        expect(getDragFollowerElements([UNIT_ID]).map(({ element }) => element)).toContain(anchor);
        expect(layer?.closest("[data-testid='unit-shell']")).toBeNull();
        expect(layer?.closest("[data-testid='clipped-image']")).toBeNull();
        expect(layer?.textContent).toContain("OCR 文本已复制");
        expect(layer?.style.width).toBe("280px");
        expect(layer?.style.maxHeight).toBe("104px");
    });

    it("mounts after the canvas notice-layer ref arrives reactively", () => {
        const [layers, setLayers] = createSignal<CanvasOverlayLayerRefs>({});
        dispose = render(
            () => (
                <>
                    <CanvasOverlayLayers onLayersChange={setLayers} />
                    <UnitEnhancementNotices
                        unitId={UNIT_ID}
                        unitX={20}
                        unitY={30}
                        unitWidth={300}
                        unitHeight={120}
                        noticesLayer={layers().notices}
                    />
                </>
            ),
            host,
        );

        uiActions.showEnhancementNotice(UNIT_ID, {
            feature: "OCR",
            title: "OCR 文本已复制",
            message: "已复制文本：reactive-ref",
        });

        const canvasLayer = host.querySelector("#unit-notices-layer");
        expect(layers().notices).toBe(canvasLayer);
        expect(canvasLayer?.querySelector("[data-hook-unit-notice-layer='true']")?.textContent)
            .toContain("reactive-ref");
    });

    it("dismisses only from the notice without relaying the click to the unit", () => {
        const shellClick = vi.fn();
        mount(shellClick);
        uiActions.showEnhancementNotice(UNIT_ID, {
            feature: "OCR",
            title: "OCR 文本已复制",
            message: "已复制文本：example",
        });

        noticesLayer.querySelector<HTMLElement>(".hook-enhancement-notice")?.dispatchEvent(
            new MouseEvent("click", { bubbles: true }),
        );

        expect(shellClick).not.toHaveBeenCalled();
        expect(enhancementNotices[UNIT_ID]).toBeUndefined();
        expect(noticesLayer.querySelector("[data-hook-unit-notice-layer='true']")).toBeNull();
        expect(getDragFollowerElements([UNIT_ID])).toEqual([]);
    });

    it("automatically removes an unclicked notice after the bounded timeout", () => {
        vi.useFakeTimers();
        mount();
        uiActions.showEnhancementNotice(UNIT_ID, {
            feature: "Loom",
            title: "连接失败",
            message: "无法连接 Loom Hook",
        });

        expect(noticesLayer.querySelector("[data-hook-unit-notice-layer='true']")).not.toBeNull();
        vi.advanceTimersByTime(ENHANCEMENT_NOTICE_TIMEOUT_MS);
        expect(enhancementNotices[UNIT_ID]).toBeUndefined();
        expect(noticesLayer.querySelector("[data-hook-unit-notice-layer='true']")).toBeNull();
    });
});
