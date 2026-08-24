import { expect, it } from "vitest";
import { resolveMissingUnitExecutionImagePorts } from "../../src/services/graphImageResolution";
import type { ArtCapability } from "../../src/services/protocol";
import type { Link, Unit } from "../../src/types/unit";

it("reports prototype-named auxiliary image ports as missing instead of reading inherited values", () => {
    const source: Unit = {
        id: "source",
        type: "sticker",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        params: {},
        inputs: [],
        outputs: [{ id: "output", type: "image", direction: "output" }],
        data: { src: "data:image/png;base64,source" },
    };
    const target: Unit = {
        id: "target",
        type: "art",
        artId: "prototype-ports",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        params: {},
        inputs: [],
        outputs: [{ id: "output", type: "image", direction: "output" }],
        data: {},
    };
    const capability: ArtCapability = {
        id: "prototype-ports",
        label: "Prototype Ports",
        description: "",
        supported_transports: ["shared_memory"],
        execution: { type: "framework_art" },
        inputs: [
            { name: "input", label: "Input", type: "image" },
            { name: "constructor", label: "Constructor", type: "image" },
            { name: "__proto__", label: "Prototype", type: "image" },
        ],
        outputs: [{ name: "output", label: "Output", type: "image" }],
        params: [],
    };
    const links: Link[] = [{
        id: "source-target",
        fromUnitId: source.id,
        fromPortId: "output",
        toUnitId: target.id,
        toPortId: "input",
    }];

    expect(resolveMissingUnitExecutionImagePorts({
        units: [source, target],
        links,
        unitId: target.id,
        capabilities: [capability],
    })).toEqual(["constructor", "__proto__"]);
});
