import type { Accessor, Setter } from "solid-js";

import { graphStore } from "../store/graphStore";
import {
    isSelecting,
    longCaptureSession,
    selectedStickerId,
    setCaptureMode,
    setIsSelecting,
    setMousePos,
} from "../store/uiStore";
import { api } from "./api";
import type { AppCaptureInputState } from "./appPointerListeners";
import type { BootProfile } from "./bootProfile";
import { runBackgroundTask } from "./backgroundTask";
import { beginCaptureSelectionState, type CaptureSelectionMode } from "./captureState";
import {
    hasActiveEditableShortcutTarget,
    hasFocusedDomShortcutOwner,
} from "./editableFocus";
import type { OverlaySyntheticDispatcher } from "./overlaySyntheticEvents";
import { syncService } from "./syncService";

type AppNativeActionControllerDependencies = {
    activeBootProfile: Accessor<BootProfile | null>;
    appSettingsOpen: Accessor<boolean>;
    setAppSettingsOpen: Setter<boolean>;
    surfaceConfirmationCount: Accessor<number>;
    rejectCurrentSurfaceConfirmation: () => Promise<void>;
    captureInput: AppCaptureInputState;
    overlaySynthetic: OverlaySyntheticDispatcher;
    beginCaptureSessionLifecycle: () => void;
    invalidateCaptureSessionLifecycle: () => void;
    resetSelection: () => void;
    prepareCaptureWindowTargets: (
        initialPoint: { x: number; y: number } | null,
    ) => Promise<void>;
    cancelAutoLongCaptureSession: () => Promise<boolean>;
    closeSelectedActionsMenu: () => boolean;
    deleteSelectedUnitOrAnnotation: () => void;
};

/** Owns native capture activation and unfocused Escape/Delete command priority. */
export function createAppNativeActionController(
    dependencies: AppNativeActionControllerDependencies,
) {
    const beginCaptureSelection = async (mode: CaptureSelectionMode) => {
        const captureStart = beginCaptureSelectionState(mode, isSelecting());
        if (!captureStart.shouldStart) {
            void api.debugLogEvent(captureStart.duplicateDebugEvent);
            return;
        }

        dependencies.beginCaptureSessionLifecycle();
        dependencies.captureInput.nativePointerActive = false;
        dependencies.captureInput.ctrlReleasedSinceCaptureStart = false;
        dependencies.overlaySynthetic.reset();
        dependencies.resetSelection();
        setCaptureMode(captureStart.captureMode);
        setIsSelecting(true);
        let initialCapturePoint: { x: number; y: number } | null = null;
        try {
            const cursor = await api.getCaptureCursorPosition();
            initialCapturePoint = { x: cursor.x, y: cursor.y };
            setMousePos(initialCapturePoint);
        } catch {
            // Backend global mouse_move refreshes this best-effort seed immediately.
        }
        await dependencies.prepareCaptureWindowTargets(initialCapturePoint);
        await api.setMouseMonitorActive(false);
        await api.setCaptureInputActive(true);
        await api.setOverlayClickThrough(true);
    };

    const handleNativeEscape = () => {
        void api.debugLogEvent("trigger-escape-listener");
        if (dependencies.surfaceConfirmationCount() > 0) {
            runBackgroundTask(
                "surface confirmation rejection",
                dependencies.rejectCurrentSurfaceConfirmation(),
            );
            return;
        }
        if (dependencies.appSettingsOpen()) {
            dependencies.setAppSettingsOpen(false);
            return;
        }
        if (hasFocusedDomShortcutOwner()) return;
        if (longCaptureSession()?.active) {
            runBackgroundTask("long capture cancellation", dependencies.cancelAutoLongCaptureSession());
            return;
        }
        if (isSelecting()) {
            dependencies.invalidateCaptureSessionLifecycle();
            dependencies.captureInput.nativePointerActive = false;
            dependencies.captureInput.ctrlReleasedSinceCaptureStart = false;
            runBackgroundTask("capture escape cleanup", (async () => {
                await api.setCaptureInputActive(false);
                dependencies.overlaySynthetic.clearHover();
                dependencies.resetSelection();
                await api.setOverlayClickThrough(true);
                if (graphStore.units.length > 0) {
                    await api.setMouseMonitorActive(true);
                    await syncService.updateBackendRects();
                }
            })());
            return;
        }
        if (hasActiveEditableShortcutTarget()) return;
        if (dependencies.closeSelectedActionsMenu()) return;
        if (!selectedStickerId()) return;
        dependencies.deleteSelectedUnitOrAnnotation();
    };

    const handleNativeDelete = () => {
        void api.debugLogEvent("trigger-delete-listener");
        if (dependencies.activeBootProfile()?.nativeAcceptance || hasFocusedDomShortcutOwner()) return;
        if (
            dependencies.appSettingsOpen()
            || dependencies.surfaceConfirmationCount() > 0
            || longCaptureSession()?.active
            || isSelecting()
            || hasActiveEditableShortcutTarget()
        ) {
            return;
        }
        if (!selectedStickerId()) return;
        dependencies.deleteSelectedUnitOrAnnotation();
    };

    return { beginCaptureSelection, handleNativeEscape, handleNativeDelete };
}
