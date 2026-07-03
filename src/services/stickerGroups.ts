import type { StickerGroup } from "../types/stickerEditing";
import type { Unit } from "../types/unit";

export const upsertStickerGroup = (groups: StickerGroup[], nextGroup: StickerGroup): StickerGroup[] => {
    const existing = groups.find((group) => group.id === nextGroup.id);
    if (!existing) {
        return [...groups, nextGroup];
    }

    return groups.map((group) => (group.id === nextGroup.id ? { ...group, ...nextGroup } : group));
};

export const removeStickerGroup = (groups: StickerGroup[], groupId: string): StickerGroup[] =>
    groups.filter((group) => group.id !== groupId);

export const toggleStickerGroupHidden = (groups: StickerGroup[], groupId: string): StickerGroup[] =>
    groups.map((group) =>
        group.id === groupId ? { ...group, hidden: !group.hidden } : group,
    );

export const toggleStickerGroupLocked = (groups: StickerGroup[], groupId: string): StickerGroup[] =>
    groups.map((group) =>
        group.id === groupId ? { ...group, locked: !group.locked } : group,
    );

export const closeStickerGroupMembers = (units: Unit[], groupId: string) => {
    const removedUnitIds = units
        .filter((unit) => unit.data.groupId === groupId)
        .map((unit) => unit.id);

    return {
        remainingUnits: units.filter((unit) => unit.data.groupId !== groupId),
        removedUnitIds,
    };
};
