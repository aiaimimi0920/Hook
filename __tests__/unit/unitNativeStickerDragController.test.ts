// @vitest-environment jsdom

import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Unit } from "../../src/types/unit";

const state = vi.hoisted(() => ({
    tauri: true,
    units: [] as Unit[],
    debugLogEvent: vi.fn(async () => undefined),
    setNativeStickerDragPreflight: vi.fn(async (_active: boolean) => undefined),
    saveStickerDragExport: vi.fn(),
    saveStickerDragExportFromPath: vi.fn(),
    updateUnitData: vi.fn(),
    renderStickerComposite: vi.fn(async () => "data:image/png;base64,Q09NUE9TSVRF"),
    prepareSnapshot: vi.fn<() => Promise<string | undefined> | undefined>(),
}));

vi.mock("../../src/services/api", () => ({
    api: {
        debugLogEvent: state.debugLogEvent,
        setNativeStickerDragPreflight: state.setNativeStickerDragPreflight,
        saveStickerDragExport: state.saveStickerDragExport,
        saveStickerDragExportFromPath: state.saveStickerDragExportFromPath,
    },
    isTauriRuntimeAvailable: () => state.tauri,
}));

vi.mock("../../src/store/graphStore", () => ({
    graphStore: {
        units: state.units,
        links: [],
        capabilities: [],
        actions: { updateUnitData: state.updateUnitData },
    },
}));

vi.mock("../../src/services/stickerExport", () => ({
    renderStickerComposite: state.renderStickerComposite,
}));
vi.mock("../../src/services/liveCaptureUnit", () => ({ prepareLiveCaptureUnitSnapshot: state.prepareSnapshot }));

import { createUnitNativeStickerDragController } from "../../src/components/unitNativeStickerDragController";

const createUnit = (): Unit => ({
    id: "drag-unit",
    type: "sticker",
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    params: {},
    inputs: [],
    outputs: [],
    data: { previewSrc: "data:image/png;base64,AQID" },
});

const flushPromises = async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

const mountController = (unit: () => Unit, element: HTMLDivElement) => {
    let dispose: () => void = () => undefined;
    let controller!: ReturnType<typeof createUnitNativeStickerDragController>;
    createRoot((rootDispose) => {
        dispose = rootDispose;
        controller = createUnitNativeStickerDragController({
            unit,
            capabilityLabel: () => undefined,
            displaySrc: () => unit().data.previewSrc || "",
            element: () => element,
        });
    });
    return { controller, dispose };
};

describe("unit native sticker drag controller", () => {
    beforeEach(() => {
        state.tauri = true;
        state.units.splice(0, state.units.length, createUnit());
        vi.clearAllMocks();
        state.prepareSnapshot.mockReset();
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("serializes preflight teardown and detaches the element listener on disposal", async () => {
        const element = document.createElement("div");
        document.body.append(element);
        const mounted = mountController(() => state.units[0], element);

        element.dispatchEvent(new MouseEvent("pointerdown", {
            clientX: 10,
            clientY: 12,
            shiftKey: true,
        }));
        await flushPromises();
        expect(state.setNativeStickerDragPreflight).toHaveBeenCalledWith(true);

        mounted.dispose();
        await flushPromises();
        expect(state.setNativeStickerDragPreflight.mock.calls.at(-1)?.[0]).toBe(false);
        const callsAfterDispose = state.setNativeStickerDragPreflight.mock.calls.length;

        element.dispatchEvent(new MouseEvent("pointerdown", { shiftKey: true }));
        await flushPromises();
        expect(state.setNativeStickerDragPreflight).toHaveBeenCalledTimes(callsAfterDispose);
    });

    it("revokes browser drag Blob URLs on dragend and on the timeout fallback", () => {
        vi.useFakeTimers();
        state.tauri = false;
        const createObjectURL = vi.fn()
            .mockReturnValueOnce("blob:drag-one")
            .mockReturnValueOnce("blob:drag-two");
        const revokeObjectURL = vi.fn();
        vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
        const element = document.createElement("div");
        const mounted = mountController(() => state.units[0], element);
        const dataTransfer = {
            effectAllowed: "none",
            clearData: vi.fn(),
            setData: vi.fn(),
        };
        const dragEvent = {
            shiftKey: true,
            currentTarget: element,
            dataTransfer,
            preventDefault: vi.fn(),
        } as unknown as DragEvent;

        mounted.controller.handleBrowserImageDragStart(dragEvent);
        element.dispatchEvent(new Event("dragend"));
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:drag-one");

        mounted.controller.handleBrowserImageDragStart(dragEvent);
        vi.advanceTimersByTime(60_000);
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:drag-two");
        expect(revokeObjectURL).toHaveBeenCalledTimes(2);
        mounted.dispose();
    });

    it("does not cache a completed drag export after the source unit is removed", async () => {
        let resolveSave!: (path: string) => void;
        state.saveStickerDragExport.mockReturnValue(new Promise<string>((resolve) => {
            resolveSave = resolve;
        }));
        const element = document.createElement("div");
        document.body.append(element);
        const unit = state.units[0];
        const mounted = mountController(() => unit, element);

        element.dispatchEvent(new MouseEvent("pointerdown", {
            clientX: 0,
            clientY: 0,
            shiftKey: true,
        }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 0 }));
        window.dispatchEvent(new MouseEvent("mouseup", { screenX: 30, screenY: 40 }));
        await vi.waitFor(() => expect(state.saveStickerDragExport).toHaveBeenCalledTimes(1));

        state.units.splice(0);
        resolveSave("C:\\temp\\stale.png");
        await flushPromises();
        expect(state.updateUnitData).not.toHaveBeenCalled();
        mounted.dispose();
    });

    it("prepares live pixels before resolving cached-path or composite export plans", async () => {
        const unit = state.units[0];
        unit.data.src = unit.data.previewSrc;
        unit.data.dragOutFilePath = "C:\\temp\\old.png";
        let release!: () => void;
        state.prepareSnapshot.mockReturnValue(new Promise<string>((resolve) => {
            release = () => {
                unit.data.dragOutFilePath = undefined;
                unit.data.src = "data:image/png;base64,TkVX";
                unit.data.previewSrc = undefined;
                resolve(unit.data.src);
            };
        }));
        state.saveStickerDragExport.mockResolvedValue("C:\\temp\\new.png");
        const element = document.createElement("div");
        document.body.append(element);
        const mounted = mountController(() => unit, element);
        element.dispatchEvent(new MouseEvent("pointerdown", { clientX: 0, clientY: 0, shiftKey: true }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 0 }));
        window.dispatchEvent(new MouseEvent("mouseup", { screenX: 30, screenY: 40 }));
        await flushPromises();
        expect(state.prepareSnapshot).toHaveBeenCalledTimes(1);
        expect(state.saveStickerDragExport).not.toHaveBeenCalled();
        release();
        await vi.waitFor(() => expect(state.saveStickerDragExport).toHaveBeenCalledTimes(1));
        expect(state.renderStickerComposite).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ src: "data:image/png;base64,TkVX" }) }),
            { liveSnapshotPrepared: true },
        );
        expect(state.saveStickerDragExport.mock.calls[0][0]).toBe("data:image/png;base64,Q09NUE9TSVRF");
        expect(state.saveStickerDragExportFromPath).not.toHaveBeenCalled();
        mounted.dispose();
    });
});
