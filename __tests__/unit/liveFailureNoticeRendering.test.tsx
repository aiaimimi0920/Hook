// @vitest-environment jsdom
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
const graph = vi.hoisted(() => ({ units: [
    { id: "older", type: "sticker" }, { id: "latest", type: "sticker" },
] }));
vi.mock("../../src/store/graphStore", () => ({ graphStore: graph }));
import { UnitEnhancementNotices } from "../../src/components/UnitEnhancementNotices";
import { showLiveCaptureAdmissionError } from "../../src/services/liveCaptureAdmissionFeedback";
import { enhancementNotices, uiActions } from "../../src/store/uiStore";

let dispose: (() => void) | undefined;
afterEach(() => {
    dispose?.(); document.body.replaceChildren();
    uiActions.dismissEnhancementNotice("older");
    uiActions.dismissEnhancementNotice("latest");
});

it("renders unbound Live failure in the last sticker's standard dismissible notice", () => {
    const host = document.createElement("div");
    const layer = document.createElement("div");
    document.body.append(host, layer);
    dispose = render(() => <>
        <UnitEnhancementNotices unitId="older" unitX={10} unitY={20}
            unitWidth={300} unitHeight={200} noticesLayer={layer} />
        <UnitEnhancementNotices unitId="latest" unitX={400} unitY={200}
            unitWidth={300} unitHeight={200} noticesLayer={layer} />
    </>, host);
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    try {
        showLiveCaptureAdmissionError("live_resource_gpu_pressure");
        const anchor = layer.querySelector<HTMLElement>("[data-hook-unit-notice-anchor]");
        expect(anchor?.dataset.hookUnitNoticeAnchor).toBe("latest");
        expect(anchor?.style.left).toBe("400px");
        const stack = anchor?.querySelector<HTMLElement>(".hook-enhancement-notice-stack");
        expect(stack?.classList.contains("right-2")).toBe(true);
        expect(stack?.classList.contains("top-2")).toBe(true);
        expect(stack?.style.pointerEvents).toBe("auto");
        expect(stack?.textContent).toContain("显存");
        expect(enhancementNotices.older ?? []).toHaveLength(0);
        expect(alert).not.toHaveBeenCalled();
        const dismiss = stack?.querySelector<HTMLButtonElement>("button");
        expect(dismiss).not.toBeNull(); dismiss!.click();
        expect(enhancementNotices.latest ?? []).toHaveLength(0);
        expect(layer.querySelector("[data-hook-unit-notice-anchor]")).toBeNull();
    } finally { alert.mockRestore(); }
});
