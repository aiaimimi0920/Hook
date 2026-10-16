import { visibleExtensionToolbarSlots, type ExtensionCommandItem } from "../../extensions/services/extensionPresentationStore";

/** OCR already has a primary button and copy actions; retain its command-palette contributions. */
export const visibleStickerExtensionToolbarSlots = (items: ExtensionCommandItem[]) =>
    visibleExtensionToolbarSlots(items.filter((item) => item.pluginId !== "neuro.official/ocr"));
