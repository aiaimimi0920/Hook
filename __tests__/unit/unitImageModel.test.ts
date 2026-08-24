// @vitest-environment jsdom

import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Unit } from "../../src/types/unit";

const state = vi.hoisted(() => ({
    units: [] as Unit[],
    readImageFromPath: vi.fn(),
    updateUnitData: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({
    api: { readImageFromPath: state.readImageFromPath },
}));

vi.mock("../../src/store/graphStore", () => ({
    graphStore: {
        units: state.units,
        links: [],
        capabilities: [],
        actions: { updateUnitData: state.updateUnitData },
    },
}));

import { createUnitImageModel } from "../../src/components/unitImageModel";

const createUnit = (filePath = "C:\\images\\current.png"): Unit => ({
    id: "image-unit",
    type: "sticker",
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    params: {},
    inputs: [],
    outputs: [],
    data: { filePath, src: "asset://current" },
});

const mountModel = (unit: () => Unit) => {
    let dispose: () => void = () => undefined;
    let model!: ReturnType<typeof createUnitImageModel>;
    createRoot((rootDispose) => {
        dispose = rootDispose;
        model = createUnitImageModel({
            unit,
            params: () => ({}),
            connectedLinks: () => [],
            resolveUnitImage: () => undefined,
            inputs: () => [{ name: "image" }],
            isShaderArt: () => false,
            artId: () => undefined,
            shaderInputSrc: () => "",
            shaderReferenceSrc: () => undefined,
        });
    });
    return { model, dispose };
};

describe("unit image model file fallback", () => {
    beforeEach(() => {
        state.units.splice(0, state.units.length, createUnit());
        vi.clearAllMocks();
    });

    it("stores a file fallback only while the same path remains current", async () => {
        state.readImageFromPath.mockResolvedValue("data:image/png;base64,Q1VSUkVOVA==");
        let currentUnit = state.units[0];
        const mounted = mountModel(() => currentUnit);

        await mounted.model.handleFileBackedImageLoadError();
        expect(state.updateUnitData).toHaveBeenCalledWith("image-unit", {
            previewSrc: "data:image/png;base64,Q1VSUkVOVA==",
        });
        mounted.dispose();
    });

    it("suppresses a fallback result after the file path changes", async () => {
        let resolveRead!: (source: string) => void;
        state.readImageFromPath.mockReturnValue(new Promise<string>((resolve) => {
            resolveRead = resolve;
        }));
        let currentUnit = state.units[0];
        const mounted = mountModel(() => currentUnit);
        const request = mounted.model.handleFileBackedImageLoadError();

        currentUnit = createUnit("C:\\images\\replacement.png");
        state.units.splice(0, state.units.length, currentUnit);
        resolveRead("data:image/png;base64,U1RBTEU=");
        await request;

        expect(state.updateUnitData).not.toHaveBeenCalled();
        mounted.dispose();
    });

    it("suppresses a fallback result after the controller is disposed", async () => {
        let resolveRead!: (source: string) => void;
        state.readImageFromPath.mockReturnValue(new Promise<string>((resolve) => {
            resolveRead = resolve;
        }));
        const mounted = mountModel(() => state.units[0]);
        const request = mounted.model.handleFileBackedImageLoadError();

        mounted.dispose();
        resolveRead("data:image/png;base64,U1RBTEU=");
        await request;
        expect(state.updateUnitData).not.toHaveBeenCalled();
    });
});
