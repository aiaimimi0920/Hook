import { listen } from "@tauri-apps/api/event";

import { selectedStickerId } from "../store/uiStore";
import type { AppListenerRegistry } from "./appListenerRegistry";
import { runBackgroundTask } from "./backgroundTask";
import { extensionCommandRouter } from "./extensionCommandRouter";

export const LEGACY_OCR_COMMAND_ID = "hook.core.ocr";

/** CP09 removes this adapter after OCR is delivered exclusively as a Capability Plugin. */
export const registerLegacyOcrCommandAdapter = async (
    registry: AppListenerRegistry,
    performOcrAction: (unitId: string) => Promise<void>,
): Promise<void> => {
    registry.push(extensionCommandRouter.registerCore(LEGACY_OCR_COMMAND_ID, () => {
        const unitId = selectedStickerId();
        if (unitId) runBackgroundTask("OCR action", performOcrAction(unitId));
    }));
    // Temporary compatibility for older native emitters during the CP04-CP09 migration window.
    await registry.register(() => listen("trigger-ocr", () => {
        void extensionCommandRouter.execute(LEGACY_OCR_COMMAND_ID);
    }));
};
