import { setLongCaptureSession } from "../store/uiStore";
import { api } from "../services/api";
import {
    activateAutoLongCaptureSession,
    restoreAutoLongCaptureExclusion,
} from "./autoLongCaptureActivation";
import {
    createAutoLongCaptureOptions,
    resolveAutoLongCaptureBurstBudget,
    resolveAutoLongCaptureBurstPollInterval,
    resolveAutoLongCapturePollInterval,
    resolveAutoLongCaptureSessionPollInterval,
    resolveAutoLongCaptureWheelPollInterval,
    shouldDrainAutoLongCaptureBeforeFinish,
    shouldLogAutoLongCaptureFrame,
    shouldLogAutoLongCaptureWheel,
    shouldUpdateAutoLongCaptureStatus,
    type AutoLongCaptureOptions,
    type CaptureRect,
    type LongCaptureAxis,
    type LongCaptureDirection,
    type LongCaptureOverlapAnalysis,
    type ManualLongCaptureFrame,
} from "../services/captureState";

type AutoLongCaptureControllerDependencies = {
    resetSelection: () => void;
    restorePostCaptureInteractivity: () => Promise<void>;
    clearCaptureHover: () => void;
    addCaptureUnit: (
        response: ManualLongCaptureFrame,
        rect: CaptureRect,
        origin: { x: number; y: number },
        mode: "long-vertical",
        scrollAxis?: LongCaptureAxis,
    ) => Promise<void>;
};

/** Owns the bounded polling, backend session, stitching, and teardown state machine. */
export function createAutoLongCaptureController(
    dependencies: AutoLongCaptureControllerDependencies,
) {
    let frames: ManualLongCaptureFrame[] = [];
    let captureRect: CaptureRect | null = null;
    let captureOrigin: { x: number; y: number } | null = null;
    let options: AutoLongCaptureOptions | null = null;
    let timer: number | null = null;
    let busySessionId: number | null = null;
    let sessionId = 0;
    let finishing = false;
    let finishPromise: Promise<boolean> | null = null;
    let activationPromise: Promise<void> | null = null;
    let backendSessionId: string | null = null;
    let backendFrameCount = 0;
    let backendDuplicateCount = 0;
    let axis: LongCaptureAxis | undefined;
    let direction: LongCaptureDirection | undefined;
    let nextPollIntervalMs: number | null = null;
    let burstBudget = 0;
    let burstDeadlineAtMs = 0;
    let lastWheelAtMs = 0;
    let lastWheelLogAtMs = 0;
    let lastFrameLogAtMs = 0;
    let lastStatusUpdateAtMs = 0;

    const stopTimer = () => {
        if (timer === null) return;
        window.clearTimeout(timer);
        timer = null;
    };

    const describeAnalysis = (analysis: LongCaptureOverlapAnalysis) => {
        switch (analysis.status) {
            case "good":
            case "weak":
                return "已保留新画面，请继续慢速滚动";
            case "duplicate":
                return "等待页面滚动，重复画面已忽略";
            case "too_small_motion":
                return "滚动距离较小，继续慢速滚动";
            case "no_overlap":
                return "正在录制画面，完成后统一拼接";
        }
    };

    const describeRecordingStatus = (status: "recorded" | "duplicate") => {
        switch (status) {
            case "recorded":
                return "已采集当前画面，可继续向上/下或左/右滚动";
            case "duplicate":
                return "等待页面滚动，重复画面已忽略";
        }
    };

    const updateSession = (
        analysis: Partial<Pick<LongCaptureOverlapAnalysis, "axis" | "direction" | "confidence">> & {
            message?: string;
            duplicateCount?: number;
        },
    ) => {
        setLongCaptureSession((session) => session && {
            ...session,
            frameCount: backendSessionId ? backendFrameCount : frames.length,
            duplicateCount: analysis.duplicateCount ?? backendDuplicateCount,
            axis: analysis.axis ?? axis,
            direction: analysis.direction ?? direction,
            confidence: analysis.confidence,
            lastMessage: analysis.message,
        });
    };

    const isCurrent = (candidateSessionId: number) =>
        candidateSessionId === sessionId && !finishing && !!captureRect && !!options;

    const setNextPollInterval = (delayMs: number | null | undefined) => {
        if (!options || delayMs == null) return;
        const clampedDelay = Math.max(
            options.wheelPollIntervalMs,
            Math.min(options.maxPollIntervalMs, Math.round(delayMs)),
        );
        nextPollIntervalMs = nextPollIntervalMs == null
            ? clampedDelay
            : Math.min(nextPollIntervalMs, clampedDelay);
    };

    const scheduleSample = (candidateSessionId = sessionId) => {
        if (!isCurrent(candidateSessionId) || !options) return;
        const delayMs = nextPollIntervalMs ?? options.pollIntervalMs;
        nextPollIntervalMs = null;
        stopTimer();
        timer = window.setTimeout(
            () => void sampleAutoLongCaptureFrame(candidateSessionId),
            delayMs,
        );
    };

    const consumeBurst = () => {
        if (!options) return false;
        const now = Date.now();
        if (burstBudget <= 0) return false;
        if (now > burstDeadlineAtMs) {
            burstBudget = 0;
            return false;
        }
        burstBudget -= 1;
        setNextPollInterval(resolveAutoLongCaptureBurstPollInterval(options, burstBudget));
        return true;
    };

    const millisSinceLastWheel = () =>
        lastWheelAtMs > 0 ? Date.now() - lastWheelAtMs : null;

    const drainBeforeFinish = async (candidateSessionId: number) => {
        if (!options) return;
        const currentOptions = options;
        const deadlineAt = Date.now() + currentOptions.finishDrainTimeoutMs;
        let drained = false;
        while (
            isCurrent(candidateSessionId)
            && shouldDrainAutoLongCaptureBeforeFinish(currentOptions, {
                busy: busySessionId === candidateSessionId,
                burstBudget,
                millisSinceLastWheel: millisSinceLastWheel(),
            })
        ) {
            if (Date.now() >= deadlineAt) {
                await api.debugLogEvent(
                    "auto-long-capture-finish-drain-timeout",
                    `session=${backendSessionId ?? "frontend"} busy=${busySessionId === candidateSessionId} burstBudget=${burstBudget} millisSinceLastWheel=${millisSinceLastWheel() ?? -1}`,
                );
                break;
            }
            drained = true;
            if (busySessionId !== candidateSessionId && burstBudget > 0) scheduleSample(candidateSessionId);
            await new Promise<void>((resolve) => {
                window.setTimeout(resolve, currentOptions.burstPollIntervalMs);
            });
        }
        if (drained) {
            await api.debugLogEvent(
                "auto-long-capture-finish-drain",
                `session=${backendSessionId ?? "frontend"} burstBudget=${burstBudget} millisSinceLastWheel=${millisSinceLastWheel() ?? -1}`,
            );
        }
    };

    const notifyAutoLongCaptureWheel = async (
        input: { deltaX?: number; deltaY?: number },
        candidateSessionId = sessionId,
    ) => {
        if (!isCurrent(candidateSessionId) || !options) return;
        const delayMs = resolveAutoLongCaptureWheelPollInterval(options, {
            axis,
            deltaX: input.deltaX,
            deltaY: input.deltaY,
        });
        if (delayMs == null) return;

        const now = Date.now();
        lastWheelAtMs = now;
        burstDeadlineAtMs = now + options.burstWindowMs;
        burstBudget = resolveAutoLongCaptureBurstBudget(options, burstBudget);
        setNextPollInterval(delayMs);
        if (shouldLogAutoLongCaptureWheel(options, now, lastWheelLogAtMs)) {
            lastWheelLogAtMs = now;
            void api.debugLogEvent(
                "auto-long-capture-wheel",
                `session=${backendSessionId ?? "frontend"} axis=${axis ?? "unknown"} deltaX=${input.deltaX ?? 0} deltaY=${input.deltaY ?? 0} nextDelayMs=${nextPollIntervalMs ?? delayMs} busy=${busySessionId === candidateSessionId} burstBudget=${burstBudget} burstDeadlineMs=${Math.max(0, burstDeadlineAtMs - now)}`,
            );
        }
        if (busySessionId === candidateSessionId) return;
        scheduleSample(candidateSessionId);
    };

    const sampleAutoLongCaptureFrame = async (candidateSessionId = sessionId) => {
        if (!isCurrent(candidateSessionId) || !captureRect || !options) return;
        if (busySessionId === candidateSessionId) return;
        busySessionId = candidateSessionId;
        try {
            if (backendSessionId) {
                const response = await api.sampleLongCaptureSession(backendSessionId);
                if (!isCurrent(candidateSessionId)) return;
                backendFrameCount = response.frameCount;
                backendDuplicateCount = response.duplicateCount;
                axis = response.axis ?? axis;
                direction = response.direction ?? direction;
                setNextPollInterval(resolveAutoLongCaptureSessionPollInterval(options, response.status));
                const now = Date.now();
                if (shouldUpdateAutoLongCaptureStatus(options, now, lastStatusUpdateAtMs)) {
                    lastStatusUpdateAtMs = now;
                    updateSession({
                        axis,
                        direction,
                        duplicateCount: response.duplicateCount,
                        message: describeRecordingStatus(response.status),
                    });
                }
                if (shouldLogAutoLongCaptureFrame(options, now, lastFrameLogAtMs)) {
                    lastFrameLogAtMs = now;
                    void api.debugLogEvent(
                        "auto-long-capture-frame",
                        `session=${backendSessionId} count=${backendFrameCount} duplicates=${response.duplicateCount} recorded=${response.recorded} status=${response.status}`,
                    );
                }
            } else {
                const currentRect = captureRect;
                const currentOptions = options;
                const frame = await api.captureRegion(
                    Math.round(currentRect.x),
                    Math.round(currentRect.y),
                    Math.round(currentRect.w),
                    Math.round(currentRect.h),
                );
                if (!isCurrent(candidateSessionId)) return;
                const previous = frames[frames.length - 1];
                if (!previous) {
                    frames = [frame];
                    setNextPollInterval(resolveAutoLongCapturePollInterval(options));
                    updateSession({ message: "已捕获首帧，开始自动扫描" });
                    await api.debugLogEvent("auto-long-capture-frame", `count=${frames.length} first=true`);
                    return;
                }
                const analysis = await api.analyzeLongCapturePair(previous.base64, frame.base64, {
                    axis,
                    direction: undefined,
                    maxScan: currentOptions.maxScan,
                    minOverlapPx: currentOptions.minOverlapPx,
                    minNewContentPx: currentOptions.minNewContentPx,
                });
                if (!isCurrent(candidateSessionId)) return;
                setNextPollInterval(resolveAutoLongCapturePollInterval(options, analysis));
                if (analysis.status === "good" || analysis.status === "weak") {
                    axis = analysis.axis ?? axis;
                    direction = analysis.direction ?? direction;
                    frames = [...frames, frame];
                    updateSession({
                        axis,
                        direction,
                        confidence: analysis.confidence,
                        message: describeAnalysis(analysis),
                    });
                    await api.debugLogEvent(
                        "auto-long-capture-frame",
                        `count=${frames.length} axis=${axis ?? "unknown"} direction=${direction ?? "unknown"} overlap=${analysis.overlapPx} confidence=${analysis.confidence.toFixed(3)}`,
                    );
                } else {
                    updateSession({
                        axis: analysis.axis,
                        direction: analysis.direction,
                        confidence: analysis.confidence,
                        message: describeAnalysis(analysis),
                    });
                }
            }
        } catch (error) {
            await api.debugLogEvent(
                "auto-long-capture-frame-failed",
                error instanceof Error ? error.message : String(error),
            );
        } finally {
            if (busySessionId === candidateSessionId) busySessionId = null;
            consumeBurst();
            scheduleSample(candidateSessionId);
        }
    };

    const startAutoLongCaptureSession = async (
        rect: CaptureRect,
        origin: { x: number; y: number },
    ) => {
        const pendingActivation = activationPromise;
        if (pendingActivation) {
            try {
                await pendingActivation;
            } catch {
                // A failed transaction performs its own rollback before settling.
            }
        }
        const pendingFinish = finishPromise;
        if (pendingFinish) {
            try {
                await pendingFinish;
            } catch {
                // A new session may start after the previous teardown settles,
                // even if a best-effort cleanup API failed.
            }
        }
        stopTimer();
        sessionId += 1;
        const currentSessionId = sessionId;
        busySessionId = null;
        finishing = false;
        frames = [];
        captureRect = rect;
        captureOrigin = origin;
        options = createAutoLongCaptureOptions(rect);
        axis = undefined;
        direction = undefined;
        nextPollIntervalMs = null;
        burstBudget = 0;
        burstDeadlineAtMs = 0;
        lastWheelAtMs = 0;
        lastWheelLogAtMs = 0;
        lastFrameLogAtMs = 0;
        lastStatusUpdateAtMs = 0;
        backendSessionId = null;
        backendFrameCount = 0;
        backendDuplicateCount = 0;

        const activation = activateAutoLongCaptureSession({
            rect,
            axis,
            sessionIsCurrent: () => currentSessionId === sessionId,
            invalidateSession: () => {
                sessionId += 1;
                stopTimer();
            },
            resetControllerState: resetState,
            resetSelection: dependencies.resetSelection,
            clearCaptureHover: dependencies.clearCaptureHover,
            restorePostCaptureInteractivity: dependencies.restorePostCaptureInteractivity,
            setBackendSessionId: (value) => {
                backendSessionId = value;
            },
            sampleInitialFrame: () => sampleAutoLongCaptureFrame(currentSessionId),
        });
        activationPromise = activation;
        try {
            await activation;
        } finally {
            if (activationPromise === activation) activationPromise = null;
        }
    };

    const resetState = () => {
        busySessionId = null;
        finishing = false;
        frames = [];
        captureRect = null;
        captureOrigin = null;
        options = null;
        axis = undefined;
        direction = undefined;
        nextPollIntervalMs = null;
        burstBudget = 0;
        burstDeadlineAtMs = 0;
        lastWheelAtMs = 0;
        lastWheelLogAtMs = 0;
        lastFrameLogAtMs = 0;
        lastStatusUpdateAtMs = 0;
        backendSessionId = null;
        backendFrameCount = 0;
        backendDuplicateCount = 0;
    };

    const finishAutoLongCaptureSession = () => {
        if (finishPromise) return finishPromise;

        const task = (async () => {
            if (activationPromise) return cancelAutoLongCaptureSession();
            try {
                await api.setCaptureInputActive(false);
            } catch (error) {
                void api.debugLogEvent(
                    "auto-long-capture-input-disable-failed",
                    error instanceof Error ? error.message : String(error),
                );
            }
            dependencies.clearCaptureHover();
            if (finishing || !captureRect || !captureOrigin || !options) return false;
            const currentSessionId = sessionId;
            const rect = captureRect;
            const origin = captureOrigin;
            const currentOptions = options;
            await drainBeforeFinish(currentSessionId);
            const currentAxis = axis;
            const currentDirection = direction;
            const framesSnapshot = [...frames];
            const currentBackendSessionId = backendSessionId;

            finishing = true;
            stopTimer();
            setLongCaptureSession((session) => session && {
                ...session,
                status: "stitching",
                lastMessage: "正在统一拼接，无法匹配的临时帧会自动跳过",
            });
            try {
                if (currentBackendSessionId) {
                    const response = await api.finishLongCaptureSession(currentBackendSessionId);
                    await dependencies.addCaptureUnit(response, rect, origin, "long-vertical", currentAxis);
                } else if (framesSnapshot.length === 0) {
                    await api.debugLogEvent("auto-long-capture-finish-empty", `session=${currentSessionId}`);
                    return false;
                } else {
                    const response = framesSnapshot.length === 1
                        ? framesSnapshot[0]
                        : await api.stitchLongCaptureFrames(
                            framesSnapshot.map((frame) => frame.base64),
                            {
                                axis: currentAxis,
                                direction: undefined,
                                maxScan: currentOptions.maxScan,
                                minOverlapPx: currentOptions.minOverlapPx,
                            },
                        );
                    await dependencies.addCaptureUnit(response, rect, origin, "long-vertical", currentAxis);
                }
                await api.debugLogEvent(
                    "auto-long-capture-finish",
                    `frames=${currentBackendSessionId ? backendFrameCount : framesSnapshot.length} duplicates=${backendDuplicateCount} axis=${currentAxis ?? "unknown"} direction=${currentDirection ?? "unknown"}`,
                );
            } catch (error) {
                await api.debugLogEvent(
                    "auto-long-capture-finish-failed",
                    error instanceof Error ? error.message : String(error),
                );
            } finally {
                if (sessionId === currentSessionId) {
                    sessionId += 1;
                    resetState();
                    setLongCaptureSession(null);
                    dependencies.resetSelection();
                    await restoreAutoLongCaptureExclusion();
                    await dependencies.restorePostCaptureInteractivity();
                }
            }
            return true;
        })();

        finishPromise = task;
        const clearFinishPromise = () => {
            if (finishPromise === task) finishPromise = null;
        };
        void task.then(clearFinishPromise, clearFinishPromise);
        return task;
    };

    const cancelAutoLongCaptureSession = async () => {
        if (finishPromise) return finishPromise;
        const hadCaptureSession = captureRect !== null;
        const currentBackendSessionId = backendSessionId;
        if (hadCaptureSession) {
            // Invalidate before the first await so an in-flight activation sees
            // stale ownership at its next native boundary.
            sessionId += 1;
            stopTimer();
            resetState();
            setLongCaptureSession(null);
            dependencies.resetSelection();
        }
        try {
            await api.setCaptureInputActive(false);
        } catch (error) {
            void api.debugLogEvent(
                "auto-long-capture-input-disable-failed",
                error instanceof Error ? error.message : String(error),
            );
        }
        dependencies.clearCaptureHover();
        if (!hadCaptureSession) return false;
        if (currentBackendSessionId) {
            try {
                await api.cancelLongCaptureSession(currentBackendSessionId);
            } catch (error) {
                void api.debugLogEvent(
                    "auto-long-capture-backend-cancel-failed",
                    error instanceof Error ? error.message : String(error),
                );
            }
        }
        void api.debugLogEvent("auto-long-capture-cancel");
        await restoreAutoLongCaptureExclusion();
        await dependencies.restorePostCaptureInteractivity();
        return true;
    };

    return {
        startAutoLongCaptureSession,
        finishAutoLongCaptureSession,
        cancelAutoLongCaptureSession,
        notifyAutoLongCaptureWheel,
    };
}
