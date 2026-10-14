import { currentExtensionTarget } from "./extensionContext";
import { extensionCommandRouter } from "./extensionCommandRouter";
import { cachedOverlayCommand } from "./extensionOverlayVisibility";
import { extensionPresentationStore } from "./extensionPresentationStore";
import { unitExtensionVisuals } from "./extensionVisualSources";
import { graphStore } from "../store/graphStore";

/** 固定工具入口复用扩展的授权、首次执行和缓存显示合同。 */
export const stickerTextOverlayActions = [
    { id: "ocr", label: "OCR", commandId: "neuro.official/ocr.toggle-overlay" },
    { id: "translation", label: "翻译", commandId: "neuro.official/text-translation.toggle-overlay" },
] as const;
export type StickerTextOverlayAction = typeof stickerTextOverlayActions[number];

const availableOverlayCommand = (unitId: string, action: StickerTextOverlayAction): string | undefined => {
    if (currentExtensionTarget()?.unitId !== unitId) return undefined;
    // Installed older capabilities enable toggle-overlay only after the first result exists.
    const candidates = [action.commandId,
        ...(action.id === "translation" ? ["neuro.official/text-translation.toggle"] : []),
        cachedOverlayCommand(action.commandId)?.fallbackCommand];
    return candidates.find((commandId) => commandId && extensionPresentationStore.paletteItems()
        .some((item) => item.commandId === commandId && item.available()));
};

export const textOverlayAvailable = (unitId: string, action: StickerTextOverlayAction): boolean =>
    !!availableOverlayCommand(unitId, action);

export const textOverlayVisible = (unitId: string, action: StickerTextOverlayAction): boolean => {
    const unit = graphStore.units.find((item) => item.id === unitId);
    const typeIds = cachedOverlayCommand(action.commandId)?.typeIds ?? [];
    return !!unit && unitExtensionVisuals(unit).some(({ attachment }) => typeIds.includes(attachment.typeId));
};

export const toggleStickerTextOverlay = async (unitId: string, action: StickerTextOverlayAction) => {
    // 工具栏可能正在切换贴图，不允许操作其他已选中的对象。
    const commandId = availableOverlayCommand(unitId, action);
    if (!commandId) throw new Error("text overlay command is unavailable for this unit");
    await extensionCommandRouter.execute(commandId);
};
