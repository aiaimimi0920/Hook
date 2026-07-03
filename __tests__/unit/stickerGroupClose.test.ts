import { describe, expect, it } from "vitest";

import { closeStickerGroupMembers } from "../../src/services/stickerGroups";
import type { Unit } from "../../src/types/unit";

const makeUnit = (id: string, groupId?: string): Unit => ({
    id,
    type: "sticker",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        src: `data:image/png;base64,${id}`,
        groupId,
    },
});

describe("sticker group close helper", () => {
    it("removes every unit in the target group and reports their ids", () => {
        const units = [
            makeUnit("a", "g1"),
            makeUnit("b"),
            makeUnit("c", "g1"),
            makeUnit("d", "g2"),
        ];

        const result = closeStickerGroupMembers(units, "g1");

        expect(result.remainingUnits.map((unit) => unit.id)).toEqual(["b", "d"]);
        expect(result.removedUnitIds).toEqual(["a", "c"]);
    });
});
