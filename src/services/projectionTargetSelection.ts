import type { DeliveryDirectory, DeliveryTarget } from "./projectionDeliveryApi";

export interface DeliveryGroup { groupId: string; name: string; targetIds: string[]; unavailableCount: number }
export interface ProjectionSelection { devices: string[]; groups: string[] }
export function parseDeliveryGroups(value: unknown, targets: DeliveryTarget[]): DeliveryGroup[] {
    if (value === undefined) return []; // Older Looms advertise devices only.
    if (!Array.isArray(value) || value.length > 32) throw new Error("projection_invalid_response");
    const ids = new Set<string>();
    const targetIds = new Set(targets.map((target) => target.deviceId));
    return value.map((entry: unknown) => {
        if (!entry || typeof entry !== "object" || !("groupId" in entry) || !("name" in entry)
            || !("targetIds" in entry) || !("unavailableCount" in entry)
            || typeof entry.groupId !== "string" || !/^[A-Za-z0-9._:/-]{1,160}$/.test(entry.groupId)
            || ids.has(entry.groupId) || typeof entry.name !== "string" || new TextEncoder().encode(entry.name).length > 128
            || !Array.isArray(entry.targetIds) || entry.targetIds.length > 64
            || entry.targetIds.some((id: unknown) => typeof id !== "string" || !targetIds.has(id))
            || new Set(entry.targetIds).size !== entry.targetIds.length
            || typeof entry.unavailableCount !== "number" || !Number.isInteger(entry.unavailableCount)
            || entry.unavailableCount < 0 || entry.unavailableCount + entry.targetIds.length > 64) throw new Error("projection_invalid_response");
        ids.add(entry.groupId);
        return { groupId: entry.groupId, name: entry.name, targetIds: entry.targetIds as string[], unavailableCount: entry.unavailableCount };
    });
}

/** Resolve only against a fresh Loom directory; overlapping groups send once per target. */
export function resolveProjectionSelection(directory: DeliveryDirectory, selection: ProjectionSelection) {
    const ids = new Set(selection.devices);
    let unavailable = 0;
    for (const groupId of new Set(selection.groups)) {
        const group = directory.groups?.find((entry) => entry.groupId === groupId);
        if (!group) { unavailable += 1; continue; }
        for (const id of group.targetIds) ids.add(id);
        unavailable += group.unavailableCount;
    }
    const targets: DeliveryTarget[] = [];
    for (const id of ids) {
        const target = directory.targets.find((entry) => entry.deviceId === id);
        if (target && (target.route === "shared_loom" || target.deliveryAvailable)) targets.push(target);
        else unavailable += 1;
    }
    return { targets, unavailable };
}
