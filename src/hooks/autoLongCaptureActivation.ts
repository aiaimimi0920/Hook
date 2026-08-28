import { setLongCaptureSession } from "../store/uiStore";
import { api } from "../services/api";
import type { CaptureRect, LongCaptureAxis } from "../services/captureState";

interface AutoLongCaptureActivationDependencies {
    rect: CaptureRect;
    axis?: LongCaptureAxis;
    sessionIsCurrent: () => boolean;
    invalidateSession: () => void;
    resetControllerState: () => void;
    resetSelection: () => void;
    clearCaptureHover: () => void;
    restorePostCaptureInteractivity: () => Promise<void>;
    setBackendSessionId: (sessionId: string | null) => void;
    sampleInitialFrame: () => Promise<void>;
}

const STALE_ACTIVATION = Symbol("stale-auto-long-capture-activation");

const logFailure = (event: string, error: unknown) => {
    void api.debugLogEvent(event, error instanceof Error ? error.message : String(error));
};

const bestEffort = async (event: string, operation: () => void | Promise<void>) => {
    try {
        await operation();
    } catch (error) {
        logFailure(event, error);
    }
};

export const restoreAutoLongCaptureExclusion = async () => {
    await bestEffort(
        "auto-long-capture-overlay-exclusion-restore-failed",
        () => api.setOverlayCaptureExclusion(false),
    );
};

/** Activates long capture transactionally so partial native setup cannot own input. */
export const activateAutoLongCaptureSession = async (
    dependencies: AutoLongCaptureActivationDependencies,
) => {
    let backendSessionId: string | null = null;
    const assertCurrent = () => {
        if (!dependencies.sessionIsCurrent()) throw STALE_ACTIVATION;
    };
    try {
        assertCurrent();
        dependencies.resetSelection();
        setLongCaptureSession({
            active: true,
            rect: dependencies.rect,
            frameCount: 0,
            duplicateCount: 0,
            status: "capturing",
            lastMessage: "请滚动目标页面，Hook 会高频采集非重复画面并在结束时统一拼接",
        });
        const { x, y, w, h } = dependencies.rect;
        void api.debugLogEvent("auto-long-capture-start", `x=${x} y=${y} w=${w} h=${h}`);
        await api.setMouseMonitorActive(false);
        assertCurrent();
        await api.setOverlayClickThrough(true);
        assertCurrent();
        try {
            await api.setOverlayCaptureExclusion(true);
        } catch (error) {
            logFailure("auto-long-capture-overlay-exclusion-failed", error);
        }
        assertCurrent();
        try {
            backendSessionId = await api.startLongCaptureSession(dependencies.rect, dependencies.axis);
            assertCurrent();
            dependencies.setBackendSessionId(backendSessionId);
            void api.debugLogEvent(
                "auto-long-capture-backend-start",
                `session=${backendSessionId} x=${x} y=${y} w=${w} h=${h} axis=${dependencies.axis ?? "auto"}`,
            );
        } catch (error) {
            assertCurrent();
            dependencies.setBackendSessionId(null);
            logFailure("auto-long-capture-backend-start-failed", error);
        }
        await dependencies.sampleInitialFrame();
        assertCurrent();
    } catch (error) {
        const current = dependencies.sessionIsCurrent();
        if (current) {
            dependencies.invalidateSession();
        }
        await bestEffort(
            "auto-long-capture-input-disable-failed",
            () => api.setCaptureInputActive(false),
        );
        await bestEffort("auto-long-capture-hover-clear-failed", dependencies.clearCaptureHover);
        const sessionToCancel = backendSessionId;
        if (sessionToCancel) {
            await bestEffort(
                "auto-long-capture-backend-cancel-failed",
                () => api.cancelLongCaptureSession(sessionToCancel),
            );
        }
        if (current) {
            await bestEffort("auto-long-capture-state-reset-failed", dependencies.resetControllerState);
            await bestEffort("auto-long-capture-public-reset-failed", () => {
                setLongCaptureSession(null);
            });
            await bestEffort("auto-long-capture-selection-reset-failed", dependencies.resetSelection);
        }
        await restoreAutoLongCaptureExclusion();
        await bestEffort(
            "auto-long-capture-interactivity-restore-failed",
            dependencies.restorePostCaptureInteractivity,
        );
        if (error !== STALE_ACTIVATION) {
            logFailure("auto-long-capture-start-rollback", error);
            throw error;
        }
    }
};
