import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnitLiveCaptureInput } from "../../src/components/UnitLiveCaptureInput";
import { OVERLAY_GLOBAL_MOUSE_UP_EVENT } from "../../src/services/overlaySyntheticEvents";
import { attachLiveCaptureUnit, detachLiveCaptureUnit, updateLiveCaptureUnitFrame, commitLiveCaptureUnitFrame } from "../../src/services/liveCaptureUnit";
import { liveCaptureActions, liveCaptureViews } from "../../src/store/liveCaptureStore";
import { graphStore } from "../../src/store/graphStore";
import { activeStickerEditTargetId, enhancementNotices, selectionActions, uiActions } from "../../src/store/uiStore";
import { useShortcuts } from "../../src/hooks/useShortcuts";
import { createAppStickerEditingController } from "../../src/services/appStickerEditingController";
import { liveUnitStatus } from "../fixtures/liveUnit";

vi.mock("../../src/services/api", () => ({
    api: {
        focusOverlayWindow: vi.fn(async () => undefined),
        debugLogEvent: vi.fn(async () => undefined),
    },
}));
vi.mock("../../src/services/syncService", () => ({
    syncService: { updateBackendRects: vi.fn(async () => undefined) },
}));

const disposers: Array<() => void> = [];
const mount = () => {
    liveCaptureActions.add(liveUnitStatus(), { x: 20, y: 30, width: 200, height: 100 });
    const onInput = vi.fn(async () => undefined);
    attachLiveCaptureUnit(liveCaptureViews[0], onInput);
    const host = document.createElement("div");
    document.body.append(host);
    const image = document.createElement("img");
    image.dataset.stickerBaseImage = "true";
    image.getBoundingClientRect = () => new DOMRect(20, 30, 200, 100);
    host.append(image);
    const inputHost = document.createElement("div");
    host.append(inputHost);
    const drag = vi.fn();
    const editing = createAppStickerEditingController({
        tauriRuntime: false, createImageUnit: () => "", disposeSurface: async () => undefined,
    });
    const toggleParams = vi.fn(() => uiActions.toggleParams("live-runtime-test"));
    const toggleActions = vi.fn(() => uiActions.toggleActions("live-runtime-test"));
    const dispose = render(() => {
        useShortcuts({ contextProvider: () => "unit-selected", handlers: {
            onToggleStickerToolbar: editing.toggleStickerToolbarVisibility,
            onToggleParams: toggleParams,
            onToggleActions: toggleActions,
        } });
        return <UnitLiveCaptureInput unit={graphStore.units[0]} element={host} onMouseDown={drag} />;
    }, inputHost);
    disposers.push(dispose);
    return { host, onInput, drag, dispose, toggleParams, toggleActions };
};

afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    detachLiveCaptureUnit("live-runtime-test");
    graphStore.actions.replaceUnits([]);
    liveCaptureActions.clear();
    selectionActions.set([]);
    uiActions.hideStickerToolbar();
    uiActions.dismissEnhancementNotice("live-runtime-test");
    document.body.replaceChildren();
});

describe("Live Unit shared input ownership", () => {
    it("keeps refused clicks on Live, with a deduplicated Unit notice rather than ordinary sticker dragging", () => {
        const { host, onInput, drag } = mount();
        liveCaptureActions.updateStatus("live-runtime-test", {
            ...liveUnitStatus(), interactionEnabled: false, inputCapability: "permission_denied",
        });
        const surface = host.querySelector(".unit-live-input")!;
        expect(surface).not.toBeNull();
        for (let i = 0; i < 2; i += 1) {
            surface.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 70, clientY: 55 }));
            surface.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        }
        expect(onInput).not.toHaveBeenCalled();
        expect(drag).not.toHaveBeenCalled();
        expect(enhancementNotices["live-runtime-test"]).toHaveLength(1);
    });

    it("routes Ctrl+E, Tab and Shift+1 through shared sticker shortcuts, not source input", async () => {
        const { host, dispose, onInput, toggleParams, toggleActions } = mount();
        const surface = host.querySelector<HTMLElement>(".unit-live-input")!;
        for (const init of [
            { key: "Tab", code: "Tab" },
            { key: "!", code: "Digit1", shiftKey: true },
            { key: "e", code: "KeyE", ctrlKey: true },
        ]) surface.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
        expect(toggleParams).toHaveBeenCalledOnce();
        expect(toggleActions).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(activeStickerEditTargetId()).toBe("live-runtime-test"));
        expect(host.querySelector(".unit-live-input")).toBeNull();
        expect(onInput).not.toHaveBeenCalled();
        dispose();
    });

    it("delegates corner drag to the same Unit drag callback without an independent position store", () => {
        const { host, dispose, drag, onInput } = mount();
        const corner = host.querySelector("[data-live-capture-move-corner='top-left']")!;
        const event = new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 20, clientY: 30 });
        corner.dispatchEvent(event);
        expect(drag).toHaveBeenCalledWith(event);
        expect(onInput).not.toHaveBeenCalled();
        dispose();
    });

    it("forwards source release at the real release coordinates after the native pre-notification", async () => {
        const { host, dispose, onInput } = mount();
        const surface = host.querySelector(".unit-live-input")!;
        surface.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 70, clientY: 55 }));
        window.dispatchEvent(new CustomEvent(OVERLAY_GLOBAL_MOUSE_UP_EVENT, { detail: { x: 170, y: 105 } }));
        surface.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 170, clientY: 105 }));
        await Promise.resolve();
        expect(onInput).toHaveBeenCalledTimes(2);
        expect(onInput).toHaveBeenLastCalledWith({ kind: "mouse_button_up", button: "left", normalizedX: 0.75, normalizedY: 0.75 });
        dispose();
    });

    it("releases a source press outside the viewport even without a synthetic pointerup", async () => {
        const { host, dispose, onInput } = mount();
        host.querySelector(".unit-live-input")!.dispatchEvent(new MouseEvent("pointerdown", {
            bubbles: true, button: 0, clientX: 70, clientY: 55,
        }));
        window.dispatchEvent(new CustomEvent(OVERLAY_GLOBAL_MOUSE_UP_EVENT, { detail: { x: 500, y: 500 } }));
        await Promise.resolve();
        expect(onInput).toHaveBeenLastCalledWith({ kind: "mouse_button_up", button: "left", normalizedX: 1, normalizedY: 1 });
        dispose();
    });

    it("does not replace graph image data every frame; explicit edit/Art snapshots commit the latest frame", () => {
        const { dispose } = mount();
        const id = "live-runtime-test";
        updateLiveCaptureUnitFrame(id, new Uint8Array([1, 2]), "image/jpeg", 1);
        const first = graphStore.units[0].data.src;
        updateLiveCaptureUnitFrame(id, new Uint8Array([3, 4]), "image/jpeg", 2);
        expect(graphStore.units[0].data.src).toBe(first);
        commitLiveCaptureUnitFrame(id);
        expect(graphStore.units[0].data.src).toBe("data:image/jpeg;base64,AwQ=");
        expect(JSON.stringify(graphStore.units[0])).not.toContain("blob:");
        dispose();
    });

    it("preserves the displayed editor snapshot when copying or saving while new frames arrive", () => {
        const { dispose } = mount();
        const id = "live-runtime-test";
        updateLiveCaptureUnitFrame(id, new Uint8Array([1, 2]), "image/jpeg", 1);
        uiActions.showStickerToolbar(id);
        updateLiveCaptureUnitFrame(id, new Uint8Array([3, 4]), "image/jpeg", 2);
        commitLiveCaptureUnitFrame(id);
        expect(graphStore.units[0].data.src).toBe("data:image/jpeg;base64,AQI=");
        dispose();
    });

    it("does not leave a blank persistent sticker when stopped before the first frame", () => {
        const { dispose } = mount();
        dispose();
        detachLiveCaptureUnit("live-runtime-test");
        expect(graphStore.units).toHaveLength(0);
    });
});
