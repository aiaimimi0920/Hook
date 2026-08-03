// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createEffect, createSignal } from "solid-js";
import { render } from "solid-js/web";

vi.mock("../../src/services/api", () => ({
    api: {
        debugLogEvent: vi.fn(),
        readImageFromPath: vi.fn(),
        setNativeStickerDragPreflight: vi.fn(),
        saveStickerDragExport: vi.fn(),
        saveStickerDragExportFromPath: vi.fn(),
    },
    isTauriRuntimeAvailable: () => false,
}));

vi.mock("../../src/components/ShaderPreview", () => ({
    ShaderPreview: (props: { onIntrinsicSizeChange?: (size: { w: number; h: number }) => void }) => {
        createEffect(() => {
            props.onIntrinsicSizeChange?.({ w: 200, h: 100 });
        });

        return <div data-testid="shader-preview" />;
    },
}));

vi.mock("../../src/components/UnitParamsPanel", () => ({
    UnitParamsPanel: () => null,
}));

vi.mock("../../src/components/UnitAddNodeMenu", () => ({
    UnitAddNodeMenu: () => null,
}));

vi.mock("../../src/components/UnitPorts", () => ({
    UnitPorts: () => null,
}));

vi.mock("../../src/components/StickerAnnotationLayer", () => ({
    StickerAnnotationLayer: () => <div data-testid="sticker-annotation-layer" />,
}));

vi.mock("../../src/components/StickerTopStrip", () => ({
    StickerTopStrip: () => null,
}));

vi.mock("../../src/services/stickerContextMenuController", () => ({
    stickerContextMenuController: {
        openForSticker: vi.fn(),
    },
}));

import { UnitView } from "../../src/components/UnitView";
import { graphStore } from "../../src/store/graphStore";
import type { ArtCapability } from "../../src/services/protocol";
import type { Link, Unit } from "../../src/types/unit";
import {
    STICKER_GPU_WARM_HOVER_DELAY_MS,
    STICKER_GPU_WARM_HOVER_GRACE_MS,
    clearStickerGpuWarmPool,
    getStickerGpuWarmPoolSnapshot,
} from "../../src/services/stickerGpuWarmPool";
import { buildSyncedImageSignature } from "../../src/services/syncedImagePayload";
import {
    deleteBakedSyncPreviewCacheEntry,
    setBakedSyncPreviewCacheEntry,
} from "../../src/services/syncImageCache";
import { resolveStickerCompositeBaseImageSrc } from "../../src/services/stickerExport";

const CAPABILITY: ArtCapability = {
    id: "color-transfer",
    label: "Color Transfer",
    description: "Shader minified restore test",
    supported_transports: ["shared_memory"],
    execution_type: "framework_art",
    metadata: { capabilities: { preview: "shader" } },
    params: [
        {
            id: "strength",
            label: "Strength",
            widget: "slider",
            default: 84,
            min: 0,
            max: 100,
            step: 1,
        },
    ],
    inputs: [{ name: "input_image", label: "Input", type: "image" }],
    outputs: [{ name: "output_image", label: "Image", type: "image" }],
};

const INPUT_UNIT: Unit = {
    id: "input-sticker",
    type: "sticker",
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        previewSrc: "data:image/png;base64,INPUT",
    },
};

const OUTPUT_UNIT: Unit = {
    id: "downstream-sticker",
    type: "sticker",
    x: 600,
    y: 200,
    w: 100,
    h: 100,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        previewSrc: "data:image/png;base64,DOWNSTREAM",
    },
};

const ART_UNIT: Unit = {
    id: "art-color-transfer",
    type: "art",
    artId: "color-transfer",
    x: 400,
    y: 200,
    w: 100,
    h: 100,
    params: { strength: 84 },
    inputs: [],
    outputs: [],
    data: {
        minified: true,
        savedRect: { x: 100, y: 200, w: 400, h: 100 },
        cropOffset: { x: 300, y: 0 },
        previewSrc: "data:image/png;base64,RESTORED",
        restoredPreviewLocked: true,
        executionConfig: {
            triggerMode: { upstreamDriven: true, paramDriven: true },
            propagation: { listenUpstream: true, notifyDownstream: true },
        },
    },
};

const INPUT_LINK: Link = {
    id: "input-link",
    fromUnitId: INPUT_UNIT.id,
    fromPortId: "output_image",
    toUnitId: ART_UNIT.id,
    toPortId: "input_image",
};

const OUTPUT_LINK: Link = {
    id: "output-link",
    fromUnitId: ART_UNIT.id,
    fromPortId: "output_image",
    toUnitId: OUTPUT_UNIT.id,
    toPortId: "image",
};

describe("UnitView restored minified shader viewport", () => {
    afterEach(() => {
        clearStickerGpuWarmPool();
        document.body.innerHTML = "";
        graphStore.setUnits([]);
        graphStore.setLinks([]);
        graphStore.setCapabilities([]);
        graphStore.setUnitParams({});
        graphStore.setUnitExecConfig({});
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("reacts to a late baked preview without remounting the live annotation tree on restore", async () => {
        const fullSticker: Unit = {
            ...INPUT_UNIT,
            id: "annotated-sticker",
            x: 100,
            y: 120,
            w: 320,
            h: 180,
            data: {
                src: "data:image/png;base64,ANNOTATED",
                annotationState: {
                    elements: [
                        {
                            id: "line-1",
                            type: "line",
                            zIndex: 1,
                            points: [{ x: 10, y: 10 }, { x: 200, y: 100 }],
                            style: { color: "#ffffff", width: 4 },
                        },
                    ],
                    serialCounter: 1,
                },
            },
        };
        const minifiedSticker: Unit = {
            ...fullSticker,
            x: 180,
            y: 150,
            w: 120,
            h: 120,
            data: {
                ...fullSticker.data,
                minified: true,
                savedRect: {
                    x: fullSticker.x,
                    y: fullSticker.y,
                    w: fullSticker.w,
                    h: fullSticker.h,
                },
                cropOffset: { x: 80, y: 30 },
            },
        };
        const [currentUnit, setCurrentUnit] = createSignal(minifiedSticker);
        graphStore.setUnits([minifiedSticker]);
        graphStore.setLinks([]);
        graphStore.setCapabilities([]);

        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <UnitView
                    unit={currentUnit()}
                    params={{}}
                    isSelected={false}
                    showActions={false}
                    showParams={false}
                    onMouseDown={() => undefined}
                    onParamChange={() => undefined}
                    onDoubleTap={() => undefined}
                    onDelete={() => undefined}
                    onAddNode={() => undefined}
                    onLinkStart={() => undefined}
                    onLinkDrop={() => undefined}
                    onLinkHover={() => undefined}
                    onRendered={() => undefined}
                    onResize={() => undefined}
                    onOpacityChange={() => undefined}
                    connectedPorts={[]}
                    connectedLinks={[]}
                    resolveUnitImage={() => undefined}
                />
            ),
            host,
        );

        await Promise.resolve();
        const annotationNode = host.querySelector('[data-testid="sticker-annotation-layer"]');
        const annotationViewport = annotationNode?.parentElement as HTMLDivElement | null;
        expect(annotationNode).toBeInstanceOf(HTMLDivElement);
        expect(annotationViewport?.style.display).toBe("block");
        expect(host.querySelector("[data-sticker-minified-baked-preview]")).toBeNull();

        const displaySrcOverride = resolveStickerCompositeBaseImageSrc({
            unit: minifiedSticker,
            units: [minifiedSticker],
            links: [],
            capabilities: [],
        }) ?? null;
        const signature = buildSyncedImageSignature(minifiedSticker, { displaySrcOverride });
        expect(signature).toBeTruthy();
        setBakedSyncPreviewCacheEntry(minifiedSticker.id, {
            signature: signature!,
            src: "data:image/png;base64,BAKED",
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(host.querySelector("[data-sticker-minified-baked-preview]")).toBeInstanceOf(
            HTMLImageElement,
        );
        expect(host.querySelector('[data-testid="sticker-annotation-layer"]')).toBe(annotationNode);
        expect(annotationViewport?.style.display).toBe("none");

        graphStore.setUnits([fullSticker]);
        setCurrentUnit(fullSticker);
        await Promise.resolve();
        await Promise.resolve();

        expect(host.querySelector("[data-sticker-minified-baked-preview]")).toBeNull();
        expect(host.querySelector('[data-testid="sticker-annotation-layer"]')).toBe(annotationNode);
        expect(annotationViewport?.style.display).toBe("block");

        dispose();
        deleteBakedSyncPreviewCacheEntry(minifiedSticker.id);
    });

    it("keeps the restored shader minified viewport stable when an unrelated downstream output sticker is deleted", async () => {
        graphStore.setUnits([INPUT_UNIT, ART_UNIT, OUTPUT_UNIT]);
        graphStore.setLinks([INPUT_LINK, OUTPUT_LINK]);
        graphStore.setCapabilities([CAPABILITY]);
        graphStore.setUnitParams({
            [ART_UNIT.id]: ART_UNIT.params,
        });
        graphStore.setUnitExecConfig({
            [ART_UNIT.id]: ART_UNIT.data.executionConfig,
        });

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <UnitView
                    unit={ART_UNIT}
                    params={graphStore.unitParams[ART_UNIT.id] || {}}
                    execConfig={graphStore.unitExecConfig[ART_UNIT.id]}
                    capability={CAPABILITY}
                    isSelected={false}
                    showActions={false}
                    showParams={false}
                    onMouseDown={() => undefined}
                    onParamChange={() => undefined}
                    onDoubleTap={() => undefined}
                    onDelete={() => undefined}
                    onAddNode={() => undefined}
                    onLinkStart={() => undefined}
                    onLinkDrop={() => undefined}
                    onLinkHover={() => undefined}
                    onRendered={() => undefined}
                    onResize={() => undefined}
                    onOpacityChange={() => undefined}
                    connectedPorts={["input_image"]}
                    connectedLinks={[INPUT_LINK]}
                    resolveUnitImage={(unitId) =>
                        graphStore.units.find((unit) => unit.id === unitId)?.data.previewSrc
                    }
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        const shaderPreview = host.querySelector('[data-testid="shader-preview"]');
        expect(shaderPreview).toBeInstanceOf(HTMLDivElement);

        const shaderWrapper = shaderPreview?.parentElement as HTMLDivElement | null;
        expect(shaderWrapper).toBeInstanceOf(HTMLDivElement);
        expect(shaderWrapper?.style.width).toBe("200px");
        expect(shaderWrapper?.style.height).toBe("100px");
        expect(shaderWrapper?.style.left).toBe("-100px");
        expect(shaderWrapper?.style.top).toBe("0px");

        graphStore.setUnits([INPUT_UNIT, ART_UNIT]);
        graphStore.setLinks([INPUT_LINK]);

        await Promise.resolve();
        await Promise.resolve();

        expect(shaderWrapper?.style.width).toBe("200px");
        expect(shaderWrapper?.style.height).toBe("100px");
        expect(shaderWrapper?.style.left).toBe("-100px");
        expect(shaderWrapper?.style.top).toBe("0px");

        dispose();
    });

    it("prewarms the sticker root from real pointer events and cleans up changed identities", async () => {
        vi.useFakeTimers();
        graphStore.setUnits([INPUT_UNIT]);
        const [currentUnit, setCurrentUnit] = createSignal(INPUT_UNIT);
        const [selected, setSelected] = createSignal(false);
        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <UnitView
                    unit={currentUnit()}
                    params={{}}
                    isSelected={selected()}
                    showActions={false}
                    showParams={false}
                    onMouseDown={() => undefined}
                    onParamChange={() => undefined}
                    onDoubleTap={() => undefined}
                    onDelete={() => undefined}
                    onAddNode={() => undefined}
                    onLinkStart={() => undefined}
                    onLinkDrop={() => undefined}
                    onLinkHover={() => undefined}
                    onRendered={() => undefined}
                    onResize={() => undefined}
                    onOpacityChange={() => undefined}
                    connectedPorts={[]}
                    connectedLinks={[]}
                />
            ),
            host,
        );

        await Promise.resolve();
        const root = host.querySelector(".unit-container") as HTMLDivElement | null;
        expect(root).toBeInstanceOf(HTMLDivElement);
        expect(getStickerGpuWarmPoolSnapshot().entries.map((entry) => entry.unitId)).toEqual([
            INPUT_UNIT.id,
        ]);

        root?.dispatchEvent(new Event("pointerenter"));
        vi.advanceTimersByTime(STICKER_GPU_WARM_HOVER_DELAY_MS);
        expect(root?.style.willChange).toBe("transform");

        root?.dispatchEvent(new Event("pointerleave"));
        vi.advanceTimersByTime(STICKER_GPU_WARM_HOVER_GRACE_MS);
        expect(root?.style.willChange).toBe("");

        setSelected(true);
        await Promise.resolve();
        expect(root?.style.willChange).toBe("transform");

        setSelected(false);
        await Promise.resolve();
        expect(root?.style.willChange).toBe("");

        const replacement = { ...INPUT_UNIT, id: "replacement-sticker" };
        setCurrentUnit(replacement);
        await Promise.resolve();
        expect(getStickerGpuWarmPoolSnapshot().entries.map((entry) => entry.unitId)).toEqual([
            replacement.id,
        ]);

        dispose();
        expect(getStickerGpuWarmPoolSnapshot().entries).toEqual([]);
    });
});
