// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

vi.mock("../../src/services/api", () => ({
    api: {
        focusOverlayWindow: vi.fn().mockResolvedValue(undefined),
        readImageFromPath: vi.fn(),
    },
}));

import { UnitParamsPanel } from "../../src/components/UnitParamsPanel";
import { api } from "../../src/services/api";
import { graphStore } from "../../src/store/graphStore";
import type { ArtCapability } from "../../src/services/protocol";
import type { Unit } from "../../src/types/unit";

beforeAll(() => {
    class ResizeObserverMock {
        observe() {}
        disconnect() {}
        unobserve() {}
    }

    (globalThis as { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver =
        ResizeObserverMock;
});

const IMAGE_SEARCH_CAPABILITY: ArtCapability = {
    id: "image-search",
    label: "图片搜索",
    description: "Search images and return multiple result candidates.",
    supported_transports: ["shared_memory"],
    params: [
        { id: "query", label: "Query", widget: "text", default: "" },
        { id: "count", label: "Count", widget: "number", default: 3 },
    ],
    inputs: [{ name: "input_image", label: "Input", type: "image" }],
    outputs: [{ name: "output_image", label: "Image", type: "image" }],
};

const BASE_UNIT: Unit = {
    id: "node-image-search",
    type: "art",
    artId: "image-search",
    x: 40,
    y: 60,
    w: 320,
    h: 200,
    params: {
        query: "日本美女",
        count: 3,
        result_index: 0,
    },
    inputs: [],
    outputs: [],
    data: {
        previewSrc: "data:image/png;base64,PREVIEW",
        resultCandidates: [
            {
                index: 0,
                title: "候选 1",
                imageUrl: "https://example.com/a.png",
                thumbnailUrl: "https://example.com/a-thumb.png",
            },
            {
                index: 1,
                title: "候选 2",
                imageUrl: "https://example.com/b.png",
                thumbnailUrl: "https://example.com/b-thumb.png",
            },
            {
                index: 2,
                title: "候选 3",
                imageUrl: "https://example.com/c.png",
                thumbnailUrl: "https://example.com/c-thumb.png",
            },
        ],
        selectedResultIndex: 0,
        executionConfig: {
            triggerMode: { upstreamDriven: true, paramDriven: true },
            propagation: { listenUpstream: true, notifyDownstream: true },
        },
    },
};

describe("UnitParamsPanel image-search result picker", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        graphStore.setUnits([]);
        graphStore.setLinks([]);
        graphStore.setCapabilities([]);
        graphStore.setUnitParams({});
        graphStore.setUnitExecConfig({});
        vi.clearAllMocks();
    });

    it("renders clickable result candidates and requests a manual re-execute for the picked index", () => {
        graphStore.setUnits([BASE_UNIT]);
        graphStore.setLinks([]);
        graphStore.setCapabilities([IMAGE_SEARCH_CAPABILITY]);
        graphStore.setUnitParams({
            [BASE_UNIT.id]: BASE_UNIT.params,
        });

        const onParamChange = vi.fn();
        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <UnitParamsPanel
                    unit={BASE_UNIT}
                    params={graphStore.unitParams[BASE_UNIT.id] || {}}
                    execConfig={{
                        triggerMode: { upstreamDriven: true, paramDriven: true },
                        propagation: { listenUpstream: true, notifyDownstream: true },
                        __expanded: false,
                    }}
                    capability={IMAGE_SEARCH_CAPABILITY}
                    connectedLinks={[]}
                    onParamChange={onParamChange}
                    onLinkStart={() => undefined}
                    onLinkDrop={() => undefined}
                    onLinkHover={() => undefined}
                    onAddNode={() => undefined}
                />
            ),
            host,
        );

        const buttons = host.querySelectorAll<HTMLButtonElement>(
            "[data-image-search-candidate-index]",
        );
        expect(buttons).toHaveLength(3);

        buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onParamChange).toHaveBeenNthCalledWith(1, "result_index", 1, false);
        expect(onParamChange).toHaveBeenCalledTimes(2);
        expect(onParamChange.mock.calls[1][0]).toBe("force_update");
        expect(typeof onParamChange.mock.calls[1][1]).toBe("number");
        expect(onParamChange.mock.calls[1][2]).toBe(true);

        dispose();
    });

    it("prefers cached local thumbnails when rendering image-search candidates", () => {
        const unitWithCachedThumb: Unit = {
            ...BASE_UNIT,
            data: {
                ...BASE_UNIT.data,
                resultCandidates: [
                    {
                        ...BASE_UNIT.data.resultCandidates![0],
                        cachedThumbnailSrc: "asset://cached/thumb-a.png",
                    },
                    BASE_UNIT.data.resultCandidates![1],
                ],
            },
        };

        graphStore.setUnits([unitWithCachedThumb]);
        graphStore.setLinks([]);
        graphStore.setCapabilities([IMAGE_SEARCH_CAPABILITY]);
        graphStore.setUnitParams({
            [unitWithCachedThumb.id]: unitWithCachedThumb.params,
        });

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <UnitParamsPanel
                    unit={unitWithCachedThumb}
                    params={graphStore.unitParams[unitWithCachedThumb.id] || {}}
                    execConfig={unitWithCachedThumb.data.executionConfig}
                    capability={IMAGE_SEARCH_CAPABILITY}
                    connectedLinks={[]}
                    onParamChange={() => undefined}
                    onLinkStart={() => undefined}
                    onLinkDrop={() => undefined}
                    onLinkHover={() => undefined}
                    onAddNode={() => undefined}
                />
            ),
            host,
        );

        const firstImage = host.querySelector<HTMLImageElement>(
            "[data-image-search-candidate-index='0'] img",
        );
        expect(firstImage?.getAttribute("src")).toBe("asset://cached/thumb-a.png");

        dispose();
    });

    it("uses the currently visible node preview for the selected candidate when no thumbnail cache exists yet", () => {
        const unitUsingVisiblePreview: Unit = {
            ...BASE_UNIT,
            data: {
                ...BASE_UNIT.data,
                previewSrc: "data:image/png;base64,SELECTED_PREVIEW",
                resultCandidates: [
                    {
                        index: 0,
                        title: "候选 1",
                        imageUrl: "https://example.com/hotlink-protected-a.png",
                    },
                    {
                        index: 1,
                        title: "候选 2",
                        imageUrl: "https://example.com/hotlink-protected-b.png",
                    },
                ],
                selectedResultIndex: 0,
            },
        };

        graphStore.setUnits([unitUsingVisiblePreview]);
        graphStore.setLinks([]);
        graphStore.setCapabilities([IMAGE_SEARCH_CAPABILITY]);
        graphStore.setUnitParams({
            [unitUsingVisiblePreview.id]: unitUsingVisiblePreview.params,
        });

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <UnitParamsPanel
                    unit={unitUsingVisiblePreview}
                    params={graphStore.unitParams[unitUsingVisiblePreview.id] || {}}
                    execConfig={unitUsingVisiblePreview.data.executionConfig}
                    capability={IMAGE_SEARCH_CAPABILITY}
                    connectedLinks={[]}
                    onParamChange={() => undefined}
                    onLinkStart={() => undefined}
                    onLinkDrop={() => undefined}
                    onLinkHover={() => undefined}
                    onAddNode={() => undefined}
                />
            ),
            host,
        );

        const selectedImage = host.querySelector<HTMLImageElement>(
            "[data-image-search-candidate-index='0'] img",
        );
        expect(selectedImage?.getAttribute("src")).toBe(
            "data:image/png;base64,SELECTED_PREVIEW",
        );

        dispose();
    });

    it("falls back to reading the cached local thumbnail as a data URL when the card image fails to load", async () => {
        vi.mocked(api.readImageFromPath).mockResolvedValue(
            "data:image/png;base64,CACHED_FALLBACK",
        );

        const unitWithBrokenCardPreview: Unit = {
            ...BASE_UNIT,
            data: {
                ...BASE_UNIT.data,
                resultCandidates: [
                    {
                        ...BASE_UNIT.data.resultCandidates![0],
                        cachedThumbnailPath: "C:\\cache\\candidate-thumb-a.png",
                        cachedThumbnailSrc: "asset://broken/thumb-a.png",
                    },
                    BASE_UNIT.data.resultCandidates![1],
                ],
            },
        };

        graphStore.setUnits([unitWithBrokenCardPreview]);
        graphStore.setLinks([]);
        graphStore.setCapabilities([IMAGE_SEARCH_CAPABILITY]);
        graphStore.setUnitParams({
            [unitWithBrokenCardPreview.id]: unitWithBrokenCardPreview.params,
        });

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <UnitParamsPanel
                    unit={unitWithBrokenCardPreview}
                    params={graphStore.unitParams[unitWithBrokenCardPreview.id] || {}}
                    execConfig={unitWithBrokenCardPreview.data.executionConfig}
                    capability={IMAGE_SEARCH_CAPABILITY}
                    connectedLinks={[]}
                    onParamChange={() => undefined}
                    onLinkStart={() => undefined}
                    onLinkDrop={() => undefined}
                    onLinkHover={() => undefined}
                    onAddNode={() => undefined}
                />
            ),
            host,
        );

        const candidateImage = host.querySelector<HTMLImageElement>(
            "[data-image-search-candidate-index='0'] img",
        );
        expect(candidateImage?.getAttribute("src")).toBe("asset://broken/thumb-a.png");

        candidateImage?.dispatchEvent(new Event("error"));
        await Promise.resolve();
        await Promise.resolve();

        expect(api.readImageFromPath).toHaveBeenCalledWith(
            "C:\\cache\\candidate-thumb-a.png",
        );
        expect(candidateImage?.getAttribute("src")).toBe(
            "data:image/png;base64,CACHED_FALLBACK",
        );

        dispose();
    });

    it("optimistically switches preview and filePath when a cached candidate is clicked", () => {
        const unitWithCachedCandidate: Unit = {
            ...BASE_UNIT,
            data: {
                ...BASE_UNIT.data,
                outputs: {
                    output: BASE_UNIT.data.previewSrc,
                    output_image: BASE_UNIT.data.previewSrc,
                    file_path: "C:\\old-cache\\old.png",
                },
                resultCandidates: [
                    BASE_UNIT.data.resultCandidates![0],
                    {
                        ...BASE_UNIT.data.resultCandidates![1],
                        cachedImagePath: "C:\\cache\\candidate-b.png",
                        cachedImageSrc: "asset://cached/candidate-b.png",
                    },
                ],
            },
        };

        graphStore.setUnits([unitWithCachedCandidate]);
        graphStore.setLinks([]);
        graphStore.setCapabilities([IMAGE_SEARCH_CAPABILITY]);
        graphStore.setUnitParams({
            [unitWithCachedCandidate.id]: unitWithCachedCandidate.params,
        });

        const onParamChange = vi.fn();
        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <UnitParamsPanel
                    unit={graphStore.units[0]}
                    params={graphStore.unitParams[unitWithCachedCandidate.id] || {}}
                    execConfig={unitWithCachedCandidate.data.executionConfig}
                    capability={IMAGE_SEARCH_CAPABILITY}
                    connectedLinks={[]}
                    onParamChange={onParamChange}
                    onLinkStart={() => undefined}
                    onLinkDrop={() => undefined}
                    onLinkHover={() => undefined}
                    onAddNode={() => undefined}
                />
            ),
            host,
        );

        const button = host.querySelector<HTMLButtonElement>(
            "[data-image-search-candidate-index='1']",
        );
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(graphStore.units[0].data.previewSrc).toBe("asset://cached/candidate-b.png");
        expect(graphStore.units[0].data.filePath).toBe("C:\\cache\\candidate-b.png");
        expect(graphStore.units[0].data.selectedResultIndex).toBe(1);
        expect(graphStore.units[0].data.outputs).toEqual({
            output: "asset://cached/candidate-b.png",
            output_image: "asset://cached/candidate-b.png",
            file_path: "C:\\cache\\candidate-b.png",
        });
        expect(onParamChange).toHaveBeenNthCalledWith(1, "result_index", 1, false);
        expect(onParamChange).toHaveBeenCalledTimes(2);

        dispose();
    });
});
