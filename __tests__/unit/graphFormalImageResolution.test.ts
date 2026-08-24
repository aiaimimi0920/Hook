import { describe, expect, it } from "vitest";
import {
    isUnitFormalImagePending,
    resolveUnitExecutionInputImage,
    resolveUnitOutputValue,
} from "../../src/services/graphImageResolution";
import type { Link, Unit } from "../../src/types/unit";
import { sticker } from "./graphImageResolutionTestFixtures";

describe("graph image resolution: formal boundaries", () => {
    it("blocks formal export through an untouched sticker while its upstream Art is processing", () => {
        const upstream: Unit = {
            id: "processing-art",
            type: "art",
            artId: "workflow-art",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            params: {},
            inputs: [],
            outputs: [{ id: "output", type: "image", direction: "output" }],
            data: {
                processing: true,
                outputs: { output: "data:image/png;base64,STALE_FORMAL" },
            },
        };
        const downstream = sticker("downstream", {});
        const links: Link[] = [{
            id: "art-to-sticker",
            fromUnitId: upstream.id,
            fromPortId: "output",
            toUnitId: downstream.id,
            toPortId: "image",
        }];

        expect(isUnitFormalImagePending({
            units: [upstream, downstream],
            links,
            unitId: downstream.id,
        })).toBe(true);

        upstream.data.processing = false;
        upstream.data.nodeStatus = "completed";
        expect(isUnitFormalImagePending({
            units: [upstream, downstream],
            links,
            unitId: downstream.id,
        })).toBe(false);
    });

    it("treats a locally edited sticker as an independent formal export boundary", () => {
        const upstream: Unit = {
            ...sticker("processing-source", {}),
            type: "art",
            data: { processing: true },
        };
        const downstream = sticker("edited-downstream", {
            stickerEditPropagation: { locallyEdited: true },
        });
        const links: Link[] = [{
            id: "art-to-edited-sticker",
            fromUnitId: upstream.id,
            fromPortId: "output",
            toUnitId: downstream.id,
            toPortId: "image",
        }];

        expect(isUnitFormalImagePending({
            units: [upstream, downstream],
            links,
            unitId: downstream.id,
        })).toBe(false);
    });

    it("keeps a workflow Art preview out of its formal output port", () => {
        const units: Unit[] = [
            {
                id: "workflow-art",
                type: "art",
                artId: "hook-wf-color-transfer-compress",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {},
                inputs: [],
                outputs: [{ id: "output", type: "image", direction: "output" }],
                data: { previewSrc: "data:image/png;base64,shader-preview" },
            },
        ];

        expect(
            resolveUnitOutputValue({
                units,
                links: [],
                unitId: "workflow-art",
                portId: "output",
            }),
        ).toBeUndefined();

        units[0].data.outputs = {
            output: "data:image/png;base64,compressed-formal",
        };

        expect(
            resolveUnitOutputValue({
                units,
                links: [],
                unitId: "workflow-art",
                portId: "output",
            }),
        ).toBe("data:image/png;base64,compressed-formal");
    });

    it("uses a workflow Art's formal output as downstream Art execution input", () => {
        const workflowArt: Unit = {
            id: "workflow-art",
            type: "art",
            artId: "hook-wf-color-transfer-compress",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            params: {},
            inputs: [],
            outputs: [{ id: "output", type: "image", direction: "output" }],
            data: { previewSrc: "data:image/png;base64,shader-preview" },
        };
        const downstreamArt: Unit = {
            id: "downstream-art",
            type: "art",
            artId: "custom-removebg",
            x: 120,
            y: 0,
            w: 100,
            h: 100,
            params: {},
            inputs: [{ id: "input", type: "image", direction: "input" }],
            outputs: [{ id: "output", type: "image", direction: "output" }],
            data: {},
        };
        const units = [workflowArt, downstreamArt];
        const links: Link[] = [
            {
                id: "workflow-to-downstream",
                fromUnitId: "workflow-art",
                fromPortId: "output",
                toUnitId: "downstream-art",
                toPortId: "input",
            },
        ];

        expect(
            resolveUnitExecutionInputImage({
                units,
                links,
                unitId: "downstream-art",
            }),
        ).toBeUndefined();

        workflowArt.data.outputs = {
            output: "data:image/png;base64,compressed-formal",
        };

        expect(
            resolveUnitExecutionInputImage({
                units,
                links,
                unitId: "downstream-art",
            }),
        ).toBe("data:image/png;base64,compressed-formal");
    });
});
