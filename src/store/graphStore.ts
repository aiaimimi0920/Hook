import { createStore, unwrap } from "solid-js/store";
import { Unit, Link } from "../types/unit";
import { ArtCapability } from "../services/protocol";
import type { StickerGroup } from "../types/stickerEditing";
import type { StickerEditSnapshot } from "../services/stickerHistory";
import type { FrozenStickerEntry } from "../services/stickerSnapshot";
import { deriveUnitExecutionConfig } from "../services/nodeExecutionConfig";
import {
    buildStickerEditPropagationPatches,
    markStickerEditPropagationLocally,
} from "../services/stickerEditPropagation";
import { scaleStickerEditDataForFrame } from "../services/stickerEditTransforms";
import {
    closeStickerGroupMembers,
    removeStickerGroup,
    toggleStickerGroupHidden,
    toggleStickerGroupLocked,
    upsertStickerGroup,
} from "../services/stickerGroups";

// Core Data Stores
const [units, setUnits] = createStore<Unit[]>([]);
const [links, setLinks] = createStore<Link[]>([]);
const [unitParams, setUnitParams] = createStore<Record<string, Record<string, any>>>({});
const [unitExecConfig, setUnitExecConfig] = createStore<Record<string, any>>({});
const [capabilities, setCapabilities] = createStore<ArtCapability[]>([]);
const [stickerGroups, setStickerGroups] = createStore<StickerGroup[]>([]);
const [recycleBin, setRecycleBin] = createStore<FrozenStickerEntry[]>([]);
const [referenceLibrary, setReferenceLibrary] = createStore<FrozenStickerEntry[]>([]);

// Actions
const addUnit = (unit: Unit) => {
    const capability = unit.artId ? capabilities.find((cap) => cap.id === unit.artId) : undefined;
    const executionConfig = deriveUnitExecutionConfig({
        capability,
        explicitConfig: unit.data?.executionConfig,
    });
    const unitWithConfig: Unit = {
        ...unit,
        data: {
            ...unit.data,
            executionConfig,
        },
    };

    setUnits((prev) => [...prev, unitWithConfig]);
    setUnitParams(unit.id, unit.params || {});
    setUnitExecConfig(unit.id, executionConfig);
};

const removeUnit = (id: string) => {
    setUnits((prev) => prev.filter((u) => u.id !== id));
    // Cascade delete links
    setLinks((prev) => prev.filter((l) => l.fromUnitId !== id && l.toUnitId !== id));
    setUnitParams(id, undefined!);
};

const updateUnit = (id: string, updates: Partial<Unit>) => {
    setUnits(
        (u) => u.id === id,
        (prev) => ({ ...prev, ...updates })
    );
};

const updateUnitData = (id: string, updates: Partial<Unit["data"]>) => {
    setUnits(
        (u) => u.id === id,
        "data",
        (prev) => ({ ...prev, ...updates })
    );
};

const updateStickerEditData = (
    id: string,
    updates: Partial<Unit["data"]>,
    options: { markLocalEdit?: boolean } = {},
) => {
    const unit = units.find((item) => item.id === id);
    const nextUpdates: Partial<Unit["data"]> = { ...updates };

    if (options.markLocalEdit !== false) {
        nextUpdates.stickerEditPropagation = markStickerEditPropagationLocally(
            unit?.data.stickerEditPropagation,
        );
    }

    updateUnitData(id, nextUpdates);
};

const resizeStickerFrame = (id: string, frame: Pick<Unit, "x" | "y" | "w" | "h">) => {
    const unit = units.find((item) => item.id === id);
    if (!unit || unit.type !== "sticker") {
        updateUnit(id, frame);
        return;
    }

    const editUpdates = scaleStickerEditDataForFrame(
        unwrap(unit.data),
        { w: unit.w, h: unit.h },
        frame,
    );

    updateUnit(id, frame);

    if (Object.keys(editUpdates).length > 0) {
        updateStickerEditData(id, editUpdates);
        propagateStickerEditsFrom(id);
    }
};

const propagateStickerEditsFrom = (sourceUnitId: string) => {
    const patches = buildStickerEditPropagationPatches({
        units: unwrap(units),
        links: unwrap(links),
        sourceUnitId,
    });

    patches.forEach((patch) => {
        updateUnitData(patch.unitId, patch.data);
    });

    return patches;
};

const updateStickerWindowState = (
    id: string,
    frame: Pick<Unit, "x" | "y" | "w" | "h">,
    dataUpdates: Partial<Unit["data"]>,
) => {
    const match = (u: Unit) => u.id === id;
    setUnits(match, "x", () => frame.x);
    setUnits(match, "y", () => frame.y);
    setUnits(match, "w", () => frame.w);
    setUnits(match, "h", () => frame.h);
    setUnits(match, "data", (prev) => ({
        ...prev,
        ...dataUpdates,
    }));
};

const restoreStickerEditSnapshot = (id: string, snapshot: StickerEditSnapshot) => {
    updateUnit(id, snapshot.unitRect);
    const dataUpdates: Partial<Unit["data"]> = {
        annotationState: snapshot.annotationState,
        imageEditState: snapshot.imageEditState,
    };

    if (snapshot.imageData) {
        Object.assign(dataUpdates, snapshot.imageData);
    }

    updateStickerEditData(id, dataUpdates);
};

const addOrUpdateStickerGroup = (group: StickerGroup) => {
    setStickerGroups((prev) => upsertStickerGroup(prev, group));
};

const deleteStickerGroup = (groupId: string) => {
    setStickerGroups((prev) => removeStickerGroup(prev, groupId));
    setUnits((unit) => unit.data?.groupId === groupId, "data", "groupId", () => undefined);
};

const setUnitGroup = (unitIds: string[], groupId: string | undefined) => {
    const ids = new Set(unitIds);
    setUnits(
        (unit) => ids.has(unit.id),
        "data",
        "groupId",
        () => groupId,
    );
};

const setGroupHidden = (groupId: string) => {
    setStickerGroups((prev) => toggleStickerGroupHidden(prev, groupId));
};

const setGroupLocked = (groupId: string) => {
    setStickerGroups((prev) => toggleStickerGroupLocked(prev, groupId));
};

const closeStickerGroup = (groupId: string) => {
    const { removedUnitIds } = closeStickerGroupMembers(units, groupId);
    removedUnitIds.forEach((id) => removeUnit(id));
    setStickerGroups((prev) => removeStickerGroup(prev, groupId));
    return removedUnitIds;
};

const addLink = (link: Link) => {
    setLinks((prev) => [...prev, link]);
};

const removeLink = (id: string) => {
    setLinks((prev) => prev.filter((l) => l.id !== id));
};

// Graph Store Facade
export const graphStore = {
    units,
    links,
    unitParams,
    unitExecConfig,
    capabilities,
    stickerGroups,
    recycleBin,
    referenceLibrary,
    setUnits,
    setLinks,
    setUnitParams,
    setUnitExecConfig,
    setCapabilities,
    setStickerGroups,
    setRecycleBin,
    setReferenceLibrary,
    actions: {
        addUnit,
        removeUnit,
        updateUnit,
        updateUnitData,
        updateStickerEditData,
        resizeStickerFrame,
        propagateStickerEditsFrom,
        updateStickerWindowState,
        restoreStickerEditSnapshot,
        addOrUpdateStickerGroup,
        deleteStickerGroup,
        setUnitGroup,
        setGroupHidden,
        setGroupLocked,
        closeStickerGroup,
        addLink,
        removeLink
    }
};
