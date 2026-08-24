import { describe, expect, it } from "vitest";
import * as graphResolution from "../../src/services/graphImageResolution";
import type { ArtCapability } from "../../src/services/protocol";
import type { Link, Unit } from "../../src/types/unit";

const sticker = (id: string, src: string): Unit => ({
    id,
    type: "sticker",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    params: {},
    inputs: [{ id: "image", type: "image", direction: "input", label: "Image" }],
    outputs: [{ id: "output_image", type: "image", direction: "output", label: "Image" }],
    data: { src },
});

const art = (
    id: string,
    artId: string,
    params: Record<string, unknown>,
    data: Unit["data"] = {},
): Unit => ({
    id,
    type: "art",
    artId,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    params,
    inputs: [],
    outputs: [{ id: "output", type: "any", direction: "output", label: "Output" }],
    data,
});

const colorTransferCapability: ArtCapability = {
    id: "color-transfer",
    label: "Color Transfer",
    description: "",
    supported_transports: ["shared_memory"],
    execution: { type: "framework_art" },
    metadata: { capabilities: { preview: "shader" } },
    inputs: [
        { name: "input", label: "Input", type: "image" },
        { name: "reference", label: "Reference", type: "image" },
    ],
    outputs: [{ name: "output", label: "Output", type: "image" }],
    params: [
        { id: "reference", label: "Reference", widget: "image_link", default: "" },
        { id: "gamma", label: "Gamma", widget: "slider", min: 0, max: 2, default: 1, step: 0.1 },
    ],
};

const resolveEffectiveNodeParams = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    capabilities?: readonly ArtCapability[];
    manualParams?: Record<string, unknown>;
}) => {
    const candidate = (graphResolution as Record<string, unknown>).resolveEffectiveNodeParams;
    expect(typeof candidate).toBe("function");
    return (candidate as (args: typeof input) => Record<string, unknown>)(input);
};

describe("effective Art node parameter resolution", () => {
    it("uses a reference link as the effective reference image instead of the stale manual reference", () => {
        const units: Unit[] = [
            sticker("reference-source", "data:image/png;base64,linked-reference"),
            art("transfer", "color-transfer", {
                reference: "data:image/png;base64,manual-reference",
                gamma: 1,
            }),
        ];
        const links: Link[] = [
            {
                id: "reference-link",
                fromUnitId: "reference-source",
                fromPortId: "output_image",
                toUnitId: "transfer",
                toPortId: "reference",
            },
        ];

        const params = resolveEffectiveNodeParams({
            units,
            links,
            unitId: "transfer",
            capabilities: [colorTransferCapability],
        });

        expect(params.reference).toBe("data:image/png;base64,linked-reference");
        expect(params.gamma).toBe(1);
    });

    it("uses a linked scalar output as the effective numeric parameter and clamps it to metadata bounds", () => {
        const units: Unit[] = [
            art("number-source", "number-source", {}, {
                outputs: {
                    output: 3.4,
                },
            } as Unit["data"]),
            art("transfer", "color-transfer", {
                gamma: 0.6,
            }),
        ];
        const links: Link[] = [
            {
                id: "gamma-link",
                fromUnitId: "number-source",
                fromPortId: "output",
                toUnitId: "transfer",
                toPortId: "gamma",
            },
        ];

        const params = resolveEffectiveNodeParams({
            units,
            links,
            unitId: "transfer",
            capabilities: [colorTransferCapability],
        });

        expect(params.gamma).toBe(2);
    });

    it("falls back to the manual value when the linked scalar output is missing", () => {
        const units: Unit[] = [
            art("empty-source", "number-source", {}, { outputs: {} } as Unit["data"]),
            art("transfer", "color-transfer", {
                gamma: 0.75,
            }),
        ];
        const links: Link[] = [
            {
                id: "missing-gamma-link",
                fromUnitId: "empty-source",
                fromPortId: "output",
                toUnitId: "transfer",
                toPortId: "gamma",
            },
        ];

        const params = resolveEffectiveNodeParams({
            units,
            links,
            unitId: "transfer",
            capabilities: [colorTransferCapability],
        });

        expect(params.gamma).toBe(0.75);
    });

    it("treats prototype-named parameters as own data without reading or mutating prototypes", () => {
        const capability: ArtCapability = {
            ...colorTransferCapability,
            id: "prototype-keys",
            params: [
                { id: "__proto__", label: "Prototype", widget: "text", default: "safe-prototype" },
                { id: "constructor", label: "Constructor", widget: "text", default: "safe-constructor" },
            ],
        };
        const defaultParams = resolveEffectiveNodeParams({
            units: [art("prototype-defaults", capability.id, {})],
            links: [],
            unitId: "prototype-defaults",
            capabilities: [capability],
        });

        expect(Object.getPrototypeOf(defaultParams)).toBe(Object.prototype);
        expect(Object.prototype.hasOwnProperty.call(defaultParams, "__proto__")).toBe(true);
        expect(defaultParams["__proto__"]).toBe("safe-prototype");
        expect(defaultParams["constructor"]).toBe("safe-constructor");

        const manualParams = JSON.parse(
            '{"__proto__":{"polluted":true},"constructor":"manual-constructor"}',
        ) as Record<string, unknown>;
        const resolvedManualParams = resolveEffectiveNodeParams({
            units: [art("prototype-manual", capability.id, manualParams)],
            links: [],
            unitId: "prototype-manual",
            capabilities: [capability],
        });

        expect(Object.getPrototypeOf(resolvedManualParams)).toBe(Object.prototype);
        expect(resolvedManualParams["__proto__"]).toEqual({ polluted: true });
        expect(resolvedManualParams["constructor"]).toBe("manual-constructor");
        expect((Object.prototype as Record<string, unknown>)["polluted"]).toBeUndefined();
    });

    it("filters capability-declared internal control parameters from defaults, manual values, and links", () => {
        const capability: ArtCapability = {
            ...colorTransferCapability,
            id: "internal-controls",
            params: [
                { id: "visible", label: "Visible", widget: "text", default: "safe-visible" },
                { id: "__ui_resize", label: "Resize", widget: "text", default: "default-resize" },
                { id: "force_update", label: "Force", widget: "text", default: "default-force" },
                { id: "__exec_manualTrigger", label: "Trigger", widget: "text", default: "default-trigger" },
            ],
        };
        const units: Unit[] = [
            art("control-source", "control-source", {}, {
                outputs: { output: "linked-control" },
            } as Unit["data"]),
            art("control-target", capability.id, {
                force_update: "manual-force",
                __exec_manualTrigger: "manual-trigger",
            }),
        ];
        const links: Link[] = [{
            id: "control-link",
            fromUnitId: "control-source",
            fromPortId: "output",
            toUnitId: "control-target",
            toPortId: "__ui_resize",
        }];

        expect(resolveEffectiveNodeParams({
            units,
            links,
            unitId: "control-target",
            capabilities: [capability],
        })).toEqual({ visible: "safe-visible" });
    });
});
