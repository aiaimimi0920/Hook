import { describe, expect, it } from "vitest";

import { restoredSessionNeedsCapabilityRefresh } from "../../src/services/restoredSessionCapabilities";
import type { Unit } from "../../src/types/unit";
import type { ArtCapability } from "../../src/services/protocol";

const mkUnit = (over: Partial<Unit> & { id: string }): Unit => ({
    id: over.id,
    type: "sticker",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    params: {},
    inputs: [],
    outputs: [],
    data: {},
    ...over,
});

const mkCapability = (id: string): ArtCapability =>
    ({
        id,
        label: id,
        description: "",
        icon: "",
        params: [],
        enabled: true,
        auto_process: false,
        defaults: {},
    }) as ArtCapability;

describe("restoredSessionNeedsCapabilityRefresh", () => {
    it("returns false when the restored session contains only sticker units", () => {
        expect(
            restoredSessionNeedsCapabilityRefresh([mkUnit({ id: "sticker-1" })], []),
        ).toBe(false);
    });

    it("returns true when a restored art node has no loaded capability catalog yet", () => {
        expect(
            restoredSessionNeedsCapabilityRefresh(
                [mkUnit({ id: "art-1", type: "art", artId: "custom-color-transfer" })],
                [],
            ),
        ).toBe(true);
    });

    it("returns false when every restored art node already has a matching capability", () => {
        expect(
            restoredSessionNeedsCapabilityRefresh(
                [mkUnit({ id: "art-1", type: "art", artId: "custom-color-transfer" })],
                [mkCapability("custom-color-transfer")],
            ),
        ).toBe(false);
    });

    it("returns true when at least one restored art node is missing from the loaded capabilities", () => {
        expect(
            restoredSessionNeedsCapabilityRefresh(
                [
                    mkUnit({ id: "art-1", type: "art", artId: "custom-color-transfer" }),
                    mkUnit({ id: "art-2", type: "art", artId: "custom-image-search" }),
                ],
                [mkCapability("custom-image-search")],
            ),
        ).toBe(true);
    });
});
