import { graphStore } from "../store/graphStore";
import { selectedStickerId } from "../store/uiStore";
import type { ExtensionTarget } from "./extensionBridgeProtocol";
import type { ExtensionWhenContext } from "./extensionWhen";

export const currentExtensionUnit = () => {
    const unitId = selectedStickerId();
    return unitId ? graphStore.units.find((unit) => unit.id === unitId) ?? null : null;
};

export const currentExtensionWhenContext = (): ExtensionWhenContext => {
    const unit = currentExtensionUnit();
    const attachmentTypes = new Set<string>();
    unit?.data.extensionState?.attachments.forEach((attachment) => attachmentTypes.add(attachment.typeId));
    return {
        unit: {
            kind: unit?.type ?? null,
            hasImage: Boolean(unit?.data.src || unit?.data.previewSrc),
        },
        attachmentTypes,
    };
};

export const currentExtensionTarget = (): ExtensionTarget | null => {
    const unit = currentExtensionUnit();
    if (!unit) return null;
    return {
        unitId: unit.id,
        revision: unit.data.stickerEditPropagation?.revision ?? 0,
    };
};
