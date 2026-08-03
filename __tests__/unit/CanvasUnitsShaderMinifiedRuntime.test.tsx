// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createEffect } from "solid-js";
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
    StickerAnnotationLayer: () => null,
}));

vi.mock("../../src/components/StickerTopStrip", () => ({
    StickerTopStrip: () => null,
}));

vi.mock("../../src/services/stickerContextMenuController", () => ({
    stickerContextMenuController: {
        openForSticker: vi.fn(),
    },
}));

import { CanvasUnits } from "../../src/components/CanvasUnits";
import { graphStore } from "../../src/store/graphStore";
import type { ArtCapability } from "../../src/services/protocol";
import type { Link, Unit } from "../../src/types/unit";

const CAPABILITY: ArtCapability = {
    id: "color-transfer",
    label: "Color Transfer",
    description: "CanvasUnits restore stability test",
    supported_transports: ["shared_memory"],
    execution_type: "framework_art",
    metadata: { capabilities: { preview: "shader" } },
    params: [],
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

const EXTRA_UNIT: Unit = {
    id: "new-unrelated-sticker",
    type: "sticker",
    x: 820,
    y: 120,
    w: 180,
    h: 120,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        previewSrc: "data:image/png;base64,EXTRA",
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
    params: {},
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

describe("CanvasUnits restored minified shader stability", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        graphStore.setUnits([]);
        graphStore.setLinks([]);
        graphStore.setCapabilities([]);
        graphStore.setUnitParams({});
        graphStore.setUnitExecConfig({});
        vi.clearAllMocks();
    });

    it("keeps the restored shader viewport stable when the downstream output sticker is removed through the real list rendering path", async () => {
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
                <CanvasUnits
                    onStartDrag={() => undefined}
                    onDoubleClick={() => undefined}
                    onDelete={() => undefined}
                    onAddNode={() => undefined}
                    onParamChange={() => undefined}
                    onLinkStart={() => undefined}
                    onLinkDrop={() => undefined}
                    onLinkMove={() => undefined}
                    onLinkHover={() => undefined}
                    onRendered={() => undefined}
                    resolveUnitImage={(unitId) =>
                        graphStore.units.find((unit) => unit.id === unitId)?.data.previewSrc
                    }
                    portsLayerRef={undefined}
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        const artContainer = host.querySelector('[data-unit-id="art-color-transfer"]') as HTMLDivElement | null;
        expect(artContainer).toBeInstanceOf(HTMLDivElement);
        const shaderPreview = artContainer?.querySelector('[data-testid="shader-preview"]');
        expect(shaderPreview).toBeInstanceOf(HTMLDivElement);
        const shaderWrapper = shaderPreview?.parentElement as HTMLDivElement | null;
        expect(shaderWrapper?.style.width).toBe("200px");
        expect(shaderWrapper?.style.height).toBe("100px");
        expect(shaderWrapper?.style.left).toBe("-100px");
        expect(shaderWrapper?.style.top).toBe("0px");

        graphStore.actions.removeUnit(OUTPUT_UNIT.id);
        await Promise.resolve();
        await Promise.resolve();

        const artContainerAfterDelete = host.querySelector('[data-unit-id="art-color-transfer"]') as HTMLDivElement | null;
        expect(artContainerAfterDelete).toBeInstanceOf(HTMLDivElement);
        const shaderPreviewAfterDelete = artContainerAfterDelete?.querySelector('[data-testid="shader-preview"]');
        expect(shaderPreviewAfterDelete).toBeInstanceOf(HTMLDivElement);
        const shaderWrapperAfterDelete = shaderPreviewAfterDelete?.parentElement as HTMLDivElement | null;
        expect(shaderWrapperAfterDelete?.style.width).toBe("200px");
        expect(shaderWrapperAfterDelete?.style.height).toBe("100px");
        expect(shaderWrapperAfterDelete?.style.left).toBe("-100px");
        expect(shaderWrapperAfterDelete?.style.top).toBe("0px");

        dispose();
    });

    it("keeps the restored shader viewport stable when an unrelated new sticker is created after startup restore", async () => {
        graphStore.setUnits([INPUT_UNIT, ART_UNIT]);
        graphStore.setLinks([INPUT_LINK]);
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
                <CanvasUnits
                    onStartDrag={() => undefined}
                    onDoubleClick={() => undefined}
                    onDelete={() => undefined}
                    onAddNode={() => undefined}
                    onParamChange={() => undefined}
                    onLinkStart={() => undefined}
                    onLinkDrop={() => undefined}
                    onLinkMove={() => undefined}
                    onLinkHover={() => undefined}
                    onRendered={() => undefined}
                    resolveUnitImage={(unitId) =>
                        graphStore.units.find((unit) => unit.id === unitId)?.data.previewSrc
                    }
                    portsLayerRef={undefined}
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        const artContainer = host.querySelector('[data-unit-id="art-color-transfer"]') as HTMLDivElement | null;
        const shaderPreview = artContainer?.querySelector('[data-testid="shader-preview"]');
        const shaderWrapper = shaderPreview?.parentElement as HTMLDivElement | null;
        expect(shaderWrapper?.style.width).toBe("200px");
        expect(shaderWrapper?.style.height).toBe("100px");
        expect(shaderWrapper?.style.left).toBe("-100px");
        expect(shaderWrapper?.style.top).toBe("0px");

        graphStore.actions.addUnit(EXTRA_UNIT);
        await Promise.resolve();
        await Promise.resolve();

        const artContainerAfterInsert = host.querySelector('[data-unit-id="art-color-transfer"]') as HTMLDivElement | null;
        const shaderPreviewAfterInsert = artContainerAfterInsert?.querySelector('[data-testid="shader-preview"]');
        const shaderWrapperAfterInsert = shaderPreviewAfterInsert?.parentElement as HTMLDivElement | null;
        expect(shaderWrapperAfterInsert?.style.width).toBe("200px");
        expect(shaderWrapperAfterInsert?.style.height).toBe("100px");
        expect(shaderWrapperAfterInsert?.style.left).toBe("-100px");
        expect(shaderWrapperAfterInsert?.style.top).toBe("0px");

        dispose();
    });
});
