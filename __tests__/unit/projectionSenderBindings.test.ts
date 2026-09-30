import { afterEach, expect, it, vi } from "vitest";
import { graphStore } from "../../src/store/graphStore";
import { mapUnitToSessionSticker } from "../../src/services/sessionStickerPayload";
import { mapSessionStickerToUnit } from "../../src/services/sessionStickerMapping";
import { sanitizeProjectionSenders, type ProjectionSenderBinding } from "../../src/services/projectionSenderBindings";
import { queueProjectionUnlinks } from "../../src/services/qrProjectionCleanup";
import { parseDeliveryGroups, resolveProjectionSelection } from "../../src/services/projectionTargetSelection";
import { projectionUnit } from "../fixtures/qrProjection";

vi.mock("../../src/services/qrProjectionCleanup", () => ({ queueProjectionUnlinks: vi.fn(), queueProjectionUnlink: vi.fn() }));
afterEach(() => { graphStore.actions.replaceUnits([]); vi.clearAllMocks(); });
const binding = (id: number): ProjectionSenderBinding => {
    const link = projectionUnit().data.qrProjection!; link.envelope.projectionId = `projection:${String(id).repeat(32)}`;
    return { link, target: { deviceId: `pc${id}`, name: `PC${id}` } };
};
it("round-trips multiple associations and pending stops; copied unit IDs do not inherit any live links", () => {
    const unit = projectionUnit(); unit.data.qrProjection = undefined;
    unit.data.projectionSenders = [binding(1), binding(2)]; unit.data.projectionSenders[1].link.stopPending = true;
    const raw = JSON.parse(JSON.stringify(mapUnitToSessionSticker(unit)));
    const restored = mapSessionStickerToUnit(raw, { capabilities: [] });
    expect(restored.data.projectionSenders).toMatchObject(unit.data.projectionSenders);
    expect(mapSessionStickerToUnit({ ...raw, id: "copy" }, { capabilities: [] }).data.projectionSenders).toBeUndefined();
    graphStore.actions.addUnit(restored); graphStore.actions.removeUnit(restored.id);
    expect(queueProjectionUnlinks).toHaveBeenCalledWith(unit.data.projectionSenders.map(({ link }) => ({ envelope: link.envelope, offlineTransport: link.offlineTransport })));
});
it("strips secrets, duplicate target identities and malformed or oversized binding sets", () => {
    const one = binding(1), two = binding(2); two.target = one.target;
    expect(sanitizeProjectionSenders([{ ...one, secret: "drop" }, two], "source")).toHaveLength(1);
    expect(sanitizeProjectionSenders([one], "source")![0]).not.toHaveProperty("secret");
    expect(sanitizeProjectionSenders(Array(9).fill(one), "source")).toBeUndefined();
    expect(sanitizeProjectionSenders([{ ...one, target: { ...one.target, peerId: "invalid" } }], "source")).toBeUndefined();
});
it("rejects foreign group references and resolves overlapping selections only from the latest directory", () => {
    const target = { deviceId: "pc2", name: "PC2", policy: "confirm" as const, route: "shared_loom" as const };
    expect(() => parseDeliveryGroups([{ groupId: "team", name: "Team", targetIds: ["unknown"], unavailableCount: 0 }], [target])).toThrow();
    const group = { groupId: "team", name: "Team", targetIds: ["pc2"], unavailableCount: 1 };
    const groups = parseDeliveryGroups([group, { ...group, groupId: "overlap", unavailableCount: 0 }], [target]);
    const result = resolveProjectionSelection({ targets: [target], groups, status: "partial" }, { devices: ["pc2", "gone"], groups: ["team", "overlap"] });
    expect(result.targets).toEqual([target]); expect(result.unavailable).toBe(2);
});
