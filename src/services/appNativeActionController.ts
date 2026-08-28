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
import { cleanupCaptureInput } from "./captureInputCleanup";
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
    let captureActivationPromise: Promise<void> | null = null;
    let captureActivationGeneration = 0;

    const performCaptureCleanup = (reason: string) => cleanupCaptureInput({
        reason,
        setCaptureInputInactive: () => api.setCaptureInputActive(false),
        clearHover: dependencies.overlaySynthetic.clearHover,
        resetSelection: dependencies.resetSelection,
        setOverlayClickThrough: () => api.setOverlayClickThrough(true),
        restoreMouseMonitor: graphStore.units.length > 0,
        setMouseMonitorActive: () => api.setMouseMonitorActive(true),
        updateBackendRects: () => syncService.updateBackendRects(),
    });

    const abortCaptureSelection = async (reason: string) => {
        captureActivationGeneration += 1;
        dependencies.invalidateCaptureSessionLifecycle();
        dependencies.captureInput.nativePointerActive = false;
        dependencies.captureInput.ctrlReleasedSinceCaptureStart = false;
        await performCaptureCleanup(reason);
    };

    const beginCaptureSelection = async (mode: CaptureSelectionMode) => {
        if (captureActivationPromise) {
            const duplicate = beginCaptureSelectionState(mode, true);
            if (!duplicate.shouldStart) void api.debugLogEvent(duplicate.duplicateDebugEvent);
            return;
        }
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
        const activationGeneration = ++captureActivationGeneration;
        const activationIsCurrent = () =>
            activationGeneration === captureActivationGeneration;

        runBackgroundTask("capture window target preparation", (async () => {
            let initialCapturePoint: { x: number; y: number } | null = null;
            try {
                const cursor = await api.getCaptureCursorPosition();
                if (!activationIsCurrent()) return;
                initialCapturePoint = { x: cursor.x, y: cursor.y };
                setMousePos(initialCapturePoint);
            } catch {
                // Backend global mouse_move refreshes this best-effort seed immediately.
            }
            if (!activationIsCurrent()) return;
            await dependencies.prepareCaptureWindowTargets(initialCapturePoint);
        })());

        const activation = (async () => {
            await api.setMouseMonitorActive(false);
            if (!activationIsCurrent()) {
                await performCaptureCleanup("activation-cancelled-after-monitor");
                return;
            }
            await api.setCaptureInputActive(true);
            if (!activationIsCurrent()) {
                await performCaptureCleanup("activation-cancelled-after-input");
                return;
            }
            await api.setOverlayClickThrough(true);
            if (!activationIsCurrent()) {
                await performCaptureCleanup("activation-cancelled-after-overlay");
            }
        })();
        captureActivationPromise = activation;
        try {
            await activation;
        } catch (error) {
            await abortCaptureSelection("activation-failed");
            throw error;
        } finally {
            if (captureActivationPromise === activation) captureActivationPromise = null;
        }
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
            runBackgroundTask("capture escape cleanup", abortCaptureSelection("escape"));
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

    return {
        beginCaptureSelection,
        abortCaptureSelection,
        handleNativeEscape,
        handleNativeDelete,
    };
}
