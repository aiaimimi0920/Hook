import type { UnitAttachment } from "../types/unitExtension";
import { api } from "../../../platform/tauri/api";
import { uiActions } from "../../workspace/state/uiStore";

/** Host-local copying is restricted to the known OCR/translation text contracts. */
export const supportsOverlayTextCopy = (attachment: UnitAttachment): boolean =>
    attachment.schemaVersion === "1" && ["neuro.official/ocr", "neuro.official/text-translation"]
        .some((plugin) => attachment.pluginId === plugin && attachment.typeId === `${plugin}.result.v1`);

export const copyOverlayText = (event: MouseEvent, unitId: string): void => {
    const root = event.currentTarget;
    const target = event.target;
    if (!(root instanceof HTMLElement) || !(target instanceof Element) || event.button !== 0) return;
    const textNode = target.closest<HTMLElement>(".surface-text[data-surface-selectable-text='true']");
    if (!textNode || !root.contains(textNode)) return;
    // Prevent the old extension click route from also copying or activating the unit.
    event.stopPropagation();
    const selection = root.ownerDocument.defaultView?.getSelection();
    if (selection && !selection.isCollapsed && selection.toString()
        && (root.contains(selection.anchorNode) || root.contains(selection.focusNode))) return;
    const text = textNode.textContent ?? "";
    if (!text.trim()) return;
    void api.copyTextToClipboard(text).then((copied) => {
        if (!copied) throw new Error("Clipboard write was denied");
    }).catch(() => uiActions.showEnhancementNotice(unitId, {
        feature: "Loom", title: "复制失败", message: "请再次点击文本重试。",
    }));
};
