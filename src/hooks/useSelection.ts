import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../services/api";

import {
    isSelecting, setIsSelecting,
    isBoxSelecting, setIsBoxSelecting,
    startPos, setStartPos,
    selectionRect, setSelectionRect,
    preciseRect, setPreciseRect,
    selectionActions,
    captureMode,
    setCaptureMode,
    setLongCaptureSession,
    uiActions,
} from "../store/uiStore";
import { createThumbnailDataUrl } from "../services/historyModel";

import { graphStore } from "../store/graphStore";
import { syncService } from "../services/syncService";
import { Unit } from "../types/unit";
import {
    CaptureRect,
    createCaptureMeta,
    createAutoLongCaptureOptions,
    shouldDrainAutoLongCaptureBeforeFinish,
    resolveAutoLongCaptureBurstBudget,
    resolveAutoLongCaptureBurstPollInterval,
    resolveAutoLongCapturePollInterval,
    resolveAutoLongCaptureSessionPollInterval,
    resolveAutoLongCaptureWheelPollInterval,
    shouldLogAutoLongCaptureFrame,
    shouldLogAutoLongCaptureWheel,
    shouldUpdateAutoLongCaptureStatus,
    AutoLongCaptureOptions,
    LongCaptureAxis,
    LongCaptureDirection,
    LongCaptureOverlapAnalysis,
    ManualLongCaptureFrame,
    isLongCaptureMode,
} from "../services/captureState";

let lastPreciseRequestTime = 0;
let isPreciseRequestPending = false;
let cachedUnitRects: {id: string, x: number, y: number, w: number, h: number}[] = [];

const resolveCaptureResponseSrc = (response: ManualLongCaptureFrame) => {
    if (response.filePath) {
        return convertFileSrc(response.filePath);
    }
    return response.fileUrl ?? response.base64;
};

export function useSelection() {
    let autoLongCaptureFrames: ManualLongCaptureFrame[] = [];
    let autoLongCaptureRect: CaptureRect | null = null;
    let autoLongCaptureOrigin: { x: number; y: number } | null = null;
    let autoLongCaptureOptions: AutoLongCaptureOptions | null = null;
    let autoLongCaptureTimer: number | null = null;
    let autoLongCaptureBusySessionId: number | null = null;
    let autoLongCaptureSessionId = 0;
    let autoLongCaptureFinishing = false;
    let autoLongCaptureBackendSessionId: string | null = null;
    let autoLongCaptureBackendFrameCount = 0;
    let autoLongCaptureBackendDuplicateCount = 0;
    let autoLongCaptureAxis: LongCaptureAxis | undefined;
    let autoLongCaptureDirection: LongCaptureDirection | undefined;
    let autoLongCaptureNextPollIntervalMs: number | null = null;
    let autoLongCaptureBurstBudget = 0;
    let autoLongCaptureBurstDeadlineAtMs = 0;
    let autoLongCaptureLastWheelAtMs = 0;
    let autoLongCaptureLastWheelLogAtMs = 0;
    let autoLongCaptureLastFrameLogAtMs = 0;
    let autoLongCaptureLastStatusUpdateAtMs = 0;

    const resetSelection = () => {
        setStartPos(null);
        setSelectionRect(null);
        setPreciseRect(null);
        setIsSelecting(false);
        setIsBoxSelecting(false);
        setCaptureMode("region");
        cachedUnitRects = [];
    };

    const stopAutoLongCaptureTimer = () => {
        if (autoLongCaptureTimer !== null) {
            window.clearTimeout(autoLongCaptureTimer);
            autoLongCaptureTimer = null;
        }
    };

    const restorePostCaptureInteractivity = async () => {
        await api.setOverlayClickThrough(true);
        if (graphStore.units.length > 0) {
            await api.setMouseMonitorActive(true);
            await syncService.updateBackendRects();
        }
    };

    const addCaptureUnit = async (
        response: ManualLongCaptureFrame,
        rect: CaptureRect,
        origin: { x: number; y: number },
        mode = captureMode(),
        scrollAxis?: LongCaptureAxis,
    ) => {
        const dpr = window.devicePixelRatio || 1;
        const cssW = response.width / dpr;
        const cssH = response.height / dpr;

        const newUnit: Unit = {
            id: crypto.randomUUID(),
            type: 'sticker',
            x: origin.x,
            y: origin.y,
            w: cssW,
            h: cssH,
            params: {},
            inputs: [],
            outputs: [],
            data: {
                src: resolveCaptureResponseSrc(response),
                filePath: response.filePath ?? undefined,
                opacityNormal: 1.0,
                opacityMini: 0.9,
                minified: false,
                captureMeta: createCaptureMeta(mode, rect, scrollAxis),
            }
        };

        graphStore.actions.addUnit(newUnit);
        selectionActions.set([newUnit.id]);
        await syncService.updateBackendRects();
        void syncService.performWorkflowSync();
        await api.debugLogEvent("selection-capture-success", `cssW=${cssW} cssH=${cssH}`);

        // Record the capture in the screenshot history (downscaled thumbnail).
        // Non-blocking: a thumbnail failure must never break the capture flow.
        void (async () => {
            try {
                const thumb = await createThumbnailDataUrl(newUnit.data.src ?? "");
                if (!thumb.thumbnail) return;
                uiActions.recordScreenshotHistory({
                    id: newUnit.id,
                    thumbnail: thumb.thumbnail,
                    width: response.width,
                    height: response.height,
                    at: Date.now(),
                });
            } catch (error) {
                console.error("Failed to record screenshot history", error);
            }
        })();
    };

    const describeLongCaptureAnalysis = (analysis: LongCaptureOverlapAnalysis) => {
        switch (analysis.status) {
            case "good":
                return "已保留新画面，请继续慢速滚动";
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

    const describeLongCaptureRecordingStatus = (
        status: "recorded" | "duplicate",
    ) => {
        switch (status) {
            case "recorded":
                return "已采集当前画面，可继续向上/下或左/右滚动";
            case "duplicate":
                return "等待页面滚动，重复画面已忽略";
        }
    };

    const updateAutoLongCaptureSession = (
        analysis: Partial<Pick<LongCaptureOverlapAnalysis, "axis" | "direction" | "confidence">> & {
            message?: string;
            duplicateCount?: number;
        },
    ) => {
        setLongCaptureSession((session) => session && {
            ...session,
            frameCount: autoLongCaptureBackendSessionId
                ? autoLongCaptureBackendFrameCount
                : autoLongCaptureFrames.length,
            duplicateCount: analysis.duplicateCount ?? autoLongCaptureBackendDuplicateCount,
            axis: analysis.axis ?? autoLongCaptureAxis,
            direction: analysis.direction ?? autoLongCaptureDirection,
            confidence: analysis.confidence,
            lastMessage: analysis.message,
        });
    };

    const isAutoLongCaptureSessionCurrent = (sessionId: number) =>
        sessionId === autoLongCaptureSessionId
        && !autoLongCaptureFinishing
        && !!autoLongCaptureRect
        && !!autoLongCaptureOptions;

    const setAutoLongCaptureNextPollInterval = (delayMs: number | null | undefined) => {
        if (!autoLongCaptureOptions || delayMs == null) return;
        const clampedDelay = Math.max(
            autoLongCaptureOptions.wheelPollIntervalMs,
            Math.min(autoLongCaptureOptions.maxPollIntervalMs, Math.round(delayMs)),
        );
        autoLongCaptureNextPollIntervalMs = autoLongCaptureNextPollIntervalMs == null
            ? clampedDelay
            : Math.min(autoLongCaptureNextPollIntervalMs, clampedDelay);
    };

    const scheduleAutoLongCaptureSample = (sessionId = autoLongCaptureSessionId) => {
        if (!isAutoLongCaptureSessionCurrent(sessionId) || !autoLongCaptureOptions) return;
        const delayMs = autoLongCaptureNextPollIntervalMs ?? autoLongCaptureOptions.pollIntervalMs;
        autoLongCaptureNextPollIntervalMs = null;
        stopAutoLongCaptureTimer();
        autoLongCaptureTimer = window.setTimeout(
            () => void sampleAutoLongCaptureFrame(sessionId),
            delayMs,
        );
    };

    const consumeAutoLongCaptureBurst = () => {
        if (!autoLongCaptureOptions) return false;
        const now = Date.now();
        if (autoLongCaptureBurstBudget <= 0) return false;
        if (now > autoLongCaptureBurstDeadlineAtMs) {
            autoLongCaptureBurstBudget = 0;
            return false;
        }
        autoLongCaptureBurstBudget -= 1;
        setAutoLongCaptureNextPollInterval(
            resolveAutoLongCaptureBurstPollInterval(autoLongCaptureOptions, autoLongCaptureBurstBudget),
        );
        return true;
    };

    const getAutoLongCaptureMillisSinceLastWheel = () =>
        autoLongCaptureLastWheelAtMs > 0 ? Date.now() - autoLongCaptureLastWheelAtMs : null;

    const drainAutoLongCaptureBeforeFinish = async (sessionId: number) => {
        if (!autoLongCaptureOptions) return;
        const options = autoLongCaptureOptions;
        const deadlineAt = Date.now() + options.finishDrainTimeoutMs;
        let drained = false;

        while (
            isAutoLongCaptureSessionCurrent(sessionId)
            && shouldDrainAutoLongCaptureBeforeFinish(options, {
                busy: autoLongCaptureBusySessionId === sessionId,
                burstBudget: autoLongCaptureBurstBudget,
                millisSinceLastWheel: getAutoLongCaptureMillisSinceLastWheel(),
            })
        ) {
            if (Date.now() >= deadlineAt) {
                await api.debugLogEvent(
                    "auto-long-capture-finish-drain-timeout",
                    `session=${autoLongCaptureBackendSessionId ?? "frontend"} busy=${autoLongCaptureBusySessionId === sessionId} burstBudget=${autoLongCaptureBurstBudget} millisSinceLastWheel=${getAutoLongCaptureMillisSinceLastWheel() ?? -1}`,
                );
                break;
            }

            drained = true;
            if (autoLongCaptureBusySessionId !== sessionId && autoLongCaptureBurstBudget > 0) {
                scheduleAutoLongCaptureSample(sessionId);
            }

            await new Promise<void>((resolve) => {
                window.setTimeout(resolve, options.burstPollIntervalMs);
            });
        }

        if (drained) {
            await api.debugLogEvent(
                "auto-long-capture-finish-drain",
                `session=${autoLongCaptureBackendSessionId ?? "frontend"} burstBudget=${autoLongCaptureBurstBudget} millisSinceLastWheel=${getAutoLongCaptureMillisSinceLastWheel() ?? -1}`,
            );
        }
    };

    const notifyAutoLongCaptureWheel = async (
        input: { deltaX?: number; deltaY?: number },
        sessionId = autoLongCaptureSessionId,
    ) => {
        if (!isAutoLongCaptureSessionCurrent(sessionId) || !autoLongCaptureOptions) return;
        const delayMs = resolveAutoLongCaptureWheelPollInterval(autoLongCaptureOptions, {
            axis: autoLongCaptureAxis,
            deltaX: input.deltaX,
            deltaY: input.deltaY,
        });
        if (delayMs == null) return;

        const now = Date.now();
        autoLongCaptureLastWheelAtMs = now;
        autoLongCaptureBurstDeadlineAtMs = now + autoLongCaptureOptions.burstWindowMs;
        autoLongCaptureBurstBudget = resolveAutoLongCaptureBurstBudget(
            autoLongCaptureOptions,
            autoLongCaptureBurstBudget,
        );
        setAutoLongCaptureNextPollInterval(delayMs);
        if (shouldLogAutoLongCaptureWheel(autoLongCaptureOptions, now, autoLongCaptureLastWheelLogAtMs)) {
            autoLongCaptureLastWheelLogAtMs = now;
            void api.debugLogEvent(
                "auto-long-capture-wheel",
                `session=${autoLongCaptureBackendSessionId ?? "frontend"} axis=${autoLongCaptureAxis ?? "unknown"} deltaX=${input.deltaX ?? 0} deltaY=${input.deltaY ?? 0} nextDelayMs=${autoLongCaptureNextPollIntervalMs ?? delayMs} busy=${autoLongCaptureBusySessionId === sessionId} burstBudget=${autoLongCaptureBurstBudget} burstDeadlineMs=${Math.max(0, autoLongCaptureBurstDeadlineAtMs - now)}`,
            );
        }

        if (autoLongCaptureBusySessionId === sessionId) {
            return;
        }

        scheduleAutoLongCaptureSample(sessionId);
    };

    const sampleAutoLongCaptureFrame = async (sessionId = autoLongCaptureSessionId) => {
        if (!isAutoLongCaptureSessionCurrent(sessionId) || !autoLongCaptureRect || !autoLongCaptureOptions) return;
        if (autoLongCaptureBusySessionId === sessionId) return;

        autoLongCaptureBusySessionId = sessionId;
        try {
            const backendSessionId = autoLongCaptureBackendSessionId;
            if (backendSessionId) {
                const response = await api.sampleLongCaptureSession(backendSessionId);
                if (!isAutoLongCaptureSessionCurrent(sessionId)) return;
                autoLongCaptureBackendFrameCount = response.frameCount;
                autoLongCaptureBackendDuplicateCount = response.duplicateCount;
                autoLongCaptureAxis = response.axis ?? autoLongCaptureAxis;
                autoLongCaptureDirection = response.direction ?? autoLongCaptureDirection;
                setAutoLongCaptureNextPollInterval(
                    resolveAutoLongCaptureSessionPollInterval(autoLongCaptureOptions, response.status),
                );
                const now = Date.now();
                if (shouldUpdateAutoLongCaptureStatus(autoLongCaptureOptions, now, autoLongCaptureLastStatusUpdateAtMs)) {
                    autoLongCaptureLastStatusUpdateAtMs = now;
                    updateAutoLongCaptureSession({
                        axis: autoLongCaptureAxis,
                        direction: autoLongCaptureDirection,
                        duplicateCount: response.duplicateCount,
                        message: describeLongCaptureRecordingStatus(response.status),
                    });
                }
                if (shouldLogAutoLongCaptureFrame(autoLongCaptureOptions, now, autoLongCaptureLastFrameLogAtMs)) {
                    autoLongCaptureLastFrameLogAtMs = now;
                    void api.debugLogEvent(
                        "auto-long-capture-frame",
                        `session=${autoLongCaptureBackendSessionId} count=${autoLongCaptureBackendFrameCount} duplicates=${response.duplicateCount} recorded=${response.recorded} status=${response.status}`,
                    );
                }
            } else {
                const rect = autoLongCaptureRect;
                const options = autoLongCaptureOptions;
                const frame = await api.captureRegion(
                    Math.round(rect.x),
                    Math.round(rect.y),
                    Math.round(rect.w),
                    Math.round(rect.h),
                );

                if (!isAutoLongCaptureSessionCurrent(sessionId)) return;

                const previous = autoLongCaptureFrames[autoLongCaptureFrames.length - 1];
                if (!previous) {
                    autoLongCaptureFrames = [frame];
                    setAutoLongCaptureNextPollInterval(
                        resolveAutoLongCapturePollInterval(autoLongCaptureOptions),
                    );
                    updateAutoLongCaptureSession({ message: "已捕获首帧，开始自动扫描" });
                    await api.debugLogEvent("auto-long-capture-frame", `count=${autoLongCaptureFrames.length} first=true`);
                    return;
                }

                const analysis = await api.analyzeLongCapturePair(previous.base64, frame.base64, {
                    axis: autoLongCaptureAxis,
                    direction: undefined,
                    maxScan: options.maxScan,
                    minOverlapPx: options.minOverlapPx,
                    minNewContentPx: options.minNewContentPx,
                });

                if (!isAutoLongCaptureSessionCurrent(sessionId)) return;
                setAutoLongCaptureNextPollInterval(
                    resolveAutoLongCapturePollInterval(autoLongCaptureOptions, analysis),
                );

                if (analysis.status === "good" || analysis.status === "weak") {
                    autoLongCaptureAxis = analysis.axis ?? autoLongCaptureAxis;
                    autoLongCaptureDirection = analysis.direction ?? autoLongCaptureDirection;
                    autoLongCaptureFrames = [...autoLongCaptureFrames, frame];
                    updateAutoLongCaptureSession({
                        axis: autoLongCaptureAxis,
                        direction: autoLongCaptureDirection,
                        confidence: analysis.confidence,
                        message: describeLongCaptureAnalysis(analysis),
                    });
                    await api.debugLogEvent(
                        "auto-long-capture-frame",
                        `count=${autoLongCaptureFrames.length} axis=${autoLongCaptureAxis ?? "unknown"} direction=${autoLongCaptureDirection ?? "unknown"} overlap=${analysis.overlapPx} confidence=${analysis.confidence.toFixed(3)}`,
                    );
                } else {
                    updateAutoLongCaptureSession({
                        axis: analysis.axis,
                        direction: analysis.direction,
                        confidence: analysis.confidence,
                        message: describeLongCaptureAnalysis(analysis),
                    });
                }
            }
        } catch (error) {
            await api.debugLogEvent("auto-long-capture-frame-failed", error instanceof Error ? error.message : String(error));
        } finally {
            if (autoLongCaptureBusySessionId === sessionId) {
                autoLongCaptureBusySessionId = null;
            }
            consumeAutoLongCaptureBurst();
            scheduleAutoLongCaptureSample(sessionId);
        }
    };

    const startAutoLongCaptureSession = async (
        rect: CaptureRect,
        origin: { x: number; y: number },
    ) => {
        stopAutoLongCaptureTimer();
        autoLongCaptureSessionId += 1;
        const sessionId = autoLongCaptureSessionId;
        autoLongCaptureBusySessionId = null;
        autoLongCaptureFinishing = false;
        autoLongCaptureFrames = [];
        autoLongCaptureRect = rect;
        autoLongCaptureOrigin = origin;
        autoLongCaptureOptions = createAutoLongCaptureOptions(rect);
        autoLongCaptureAxis = undefined;
        autoLongCaptureDirection = undefined;
        autoLongCaptureNextPollIntervalMs = null;
        autoLongCaptureBurstBudget = 0;
        autoLongCaptureBurstDeadlineAtMs = 0;
        autoLongCaptureLastWheelAtMs = 0;
        autoLongCaptureLastWheelLogAtMs = 0;
        autoLongCaptureLastFrameLogAtMs = 0;
        autoLongCaptureLastStatusUpdateAtMs = 0;
        autoLongCaptureBackendSessionId = null;
        autoLongCaptureBackendFrameCount = 0;
        autoLongCaptureBackendDuplicateCount = 0;

        resetSelection();
        setLongCaptureSession({
            active: true,
            rect,
            frameCount: 0,
            duplicateCount: 0,
            status: "capturing",
            lastMessage: "请滚动目标页面，Hook 会高频采集非重复画面并在结束时统一拼接",
        });
        await api.debugLogEvent("auto-long-capture-start", `x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h}`);
        await api.setMouseMonitorActive(false);
        await api.setOverlayClickThrough(true);
        try {
            await api.setOverlayCaptureExclusion(true);
        } catch (error) {
            await api.debugLogEvent(
                "auto-long-capture-overlay-exclusion-failed",
                error instanceof Error ? error.message : String(error),
            );
        }
        try {
            autoLongCaptureBackendSessionId = await api.startLongCaptureSession(rect, autoLongCaptureAxis);
            await api.debugLogEvent(
                "auto-long-capture-backend-start",
                `session=${autoLongCaptureBackendSessionId} x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h} axis=${autoLongCaptureAxis ?? "auto"}`,
            );
        } catch (error) {
            autoLongCaptureBackendSessionId = null;
            await api.debugLogEvent(
                "auto-long-capture-backend-start-failed",
                error instanceof Error ? error.message : String(error),
            );
        }
        await sampleAutoLongCaptureFrame(sessionId);
    };

    const finishAutoLongCaptureSession = async () => {
        if (autoLongCaptureFinishing) return false;
        if (!autoLongCaptureRect || !autoLongCaptureOrigin || !autoLongCaptureOptions) {
            return false;
        }

        const sessionId = autoLongCaptureSessionId;
        const rect = autoLongCaptureRect;
        const origin = autoLongCaptureOrigin;
        const options = autoLongCaptureOptions;
        await drainAutoLongCaptureBeforeFinish(sessionId);
        const axis = autoLongCaptureAxis;
        const direction = autoLongCaptureDirection;
        const framesSnapshot = [...autoLongCaptureFrames];
        const backendSessionId = autoLongCaptureBackendSessionId;

        autoLongCaptureFinishing = true;
        stopAutoLongCaptureTimer();
        setLongCaptureSession((session) => session && {
            ...session,
            status: "stitching",
            lastMessage: "正在统一拼接，无法匹配的临时帧会自动跳过",
        });

        try {
            if (backendSessionId) {
                const response = await api.finishLongCaptureSession(backendSessionId);
                await addCaptureUnit(response, rect, origin, "long-vertical", axis);
            } else if (framesSnapshot.length === 0) {
                await api.debugLogEvent("auto-long-capture-finish-empty", `session=${sessionId}`);
                return false;
            } else {
                const response = framesSnapshot.length === 1
                    ? framesSnapshot[0]
                    : await api.stitchLongCaptureFrames(
                        framesSnapshot.map((frame) => frame.base64),
                        {
                            axis,
                            direction: undefined,
                            maxScan: options.maxScan,
                            minOverlapPx: options.minOverlapPx,
                        },
                    );
                await addCaptureUnit(response, rect, origin, "long-vertical", axis);
            }
            await api.debugLogEvent(
                "auto-long-capture-finish",
                `frames=${backendSessionId ? autoLongCaptureBackendFrameCount : framesSnapshot.length} duplicates=${autoLongCaptureBackendDuplicateCount} axis=${axis ?? "unknown"} direction=${direction ?? "unknown"}`,
            );
        } catch (error) {
            await api.debugLogEvent("auto-long-capture-finish-failed", error instanceof Error ? error.message : String(error));
        } finally {
            if (autoLongCaptureSessionId === sessionId) {
                autoLongCaptureSessionId += 1;
            }
            autoLongCaptureBusySessionId = null;
            autoLongCaptureFinishing = false;
            autoLongCaptureFrames = [];
            autoLongCaptureRect = null;
            autoLongCaptureOrigin = null;
            autoLongCaptureOptions = null;
            autoLongCaptureAxis = undefined;
            autoLongCaptureDirection = undefined;
            autoLongCaptureNextPollIntervalMs = null;
            autoLongCaptureBurstBudget = 0;
            autoLongCaptureBurstDeadlineAtMs = 0;
            autoLongCaptureLastWheelAtMs = 0;
            autoLongCaptureLastWheelLogAtMs = 0;
            autoLongCaptureLastFrameLogAtMs = 0;
            autoLongCaptureLastStatusUpdateAtMs = 0;
            autoLongCaptureBackendSessionId = null;
            autoLongCaptureBackendFrameCount = 0;
            autoLongCaptureBackendDuplicateCount = 0;
            setLongCaptureSession(null);
            resetSelection();
            try {
                await api.setOverlayCaptureExclusion(false);
            } catch (error) {
                await api.debugLogEvent(
                    "auto-long-capture-overlay-exclusion-restore-failed",
                    error instanceof Error ? error.message : String(error),
                );
            }
            await restorePostCaptureInteractivity();
        }
        return true;
    };

    const cancelAutoLongCaptureSession = async () => {
        if (!autoLongCaptureRect) return false;
        autoLongCaptureSessionId += 1;
        autoLongCaptureBusySessionId = null;
        autoLongCaptureFinishing = false;
        stopAutoLongCaptureTimer();
        autoLongCaptureFrames = [];
        autoLongCaptureRect = null;
        autoLongCaptureOrigin = null;
        autoLongCaptureOptions = null;
        autoLongCaptureAxis = undefined;
        autoLongCaptureDirection = undefined;
        autoLongCaptureNextPollIntervalMs = null;
        autoLongCaptureBurstBudget = 0;
        autoLongCaptureBurstDeadlineAtMs = 0;
        autoLongCaptureLastWheelAtMs = 0;
        autoLongCaptureLastWheelLogAtMs = 0;
        autoLongCaptureLastFrameLogAtMs = 0;
        autoLongCaptureLastStatusUpdateAtMs = 0;
        if (autoLongCaptureBackendSessionId) {
            try {
                await api.cancelLongCaptureSession(autoLongCaptureBackendSessionId);
            } catch (error) {
                await api.debugLogEvent(
                    "auto-long-capture-backend-cancel-failed",
                    error instanceof Error ? error.message : String(error),
                );
            }
        }
        autoLongCaptureBackendSessionId = null;
        autoLongCaptureBackendFrameCount = 0;
        autoLongCaptureBackendDuplicateCount = 0;
        setLongCaptureSession(null);
        resetSelection();
        await api.debugLogEvent("auto-long-capture-cancel");
        try {
            await api.setOverlayCaptureExclusion(false);
        } catch (error) {
            await api.debugLogEvent(
                "auto-long-capture-overlay-exclusion-restore-failed",
                error instanceof Error ? error.message : String(error),
            );
        }
        await restorePostCaptureInteractivity();
        return true;
    };

    const handleSelectionStart = (e: Pick<MouseEvent, "clientX" | "clientY" | "shiftKey" | "ctrlKey">) => {
         // Mode 1: Capture (Explicitly triggered)
         if (isSelecting()) {
             void api.debugLogEvent("selection-start", `x=${e.clientX} y=${e.clientY}`);
             setStartPos({ x: e.clientX, y: e.clientY });
             setSelectionRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
             return;
         }

         // Mode 2: Box Selection (Implicit)
         setIsBoxSelecting(true);
         setStartPos({ x: e.clientX, y: e.clientY });
         setSelectionRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });

         // Clear selection if not modified
         if (!e.shiftKey && !e.ctrlKey) {
             selectionActions.clear();
         }

         // Cache Geometry
         cachedUnitRects = graphStore.units.map(u => ({
             id: u.id, x: u.x, y: u.y, w: u.w, h: u.h
         }));
    };

    const handleSelectionMove = (e: Pick<MouseEvent, "clientX" | "clientY" | "shiftKey" | "ctrlKey">) => {
        const start = startPos();
        if ((!isSelecting() && !isBoxSelecting()) || !start) return;


        const current = { x: e.clientX, y: e.clientY };

        // Determine direction
        const isLeft = current.x < start.x;
        const isUp = current.y < start.y;

        const w = Math.abs(start.x - current.x);
        const h = Math.abs(start.y - current.y);

        let snappedW = w;
        let snappedH = h;

        // === CAPTURE MODE VISUALS ===
        if (isSelecting()) {
            // Shift-Snap (10px increments)
            if (e.shiftKey) {
                snappedW = Math.round(w / 10) * 10;
                snappedH = Math.round(h / 10) * 10;
            }
        }

        // Ctrl-Precise Match (Backend)
        if (e.ctrlKey && isSelecting() && w > 0 && h > 0) {
            const now = Date.now();
            if (now - lastPreciseRequestTime > 60 && !isPreciseRequestPending) {
                isPreciseRequestPending = true;
                lastPreciseRequestTime = now;

                (async () => {
                    try {
                        const dpr = window.devicePixelRatio || 1;
                        const absW = Math.abs(w);
                        const absH = Math.abs(h);
                        const topLeftX = isLeft ? start.x - absW : start.x;
                        const topLeftY = isUp ? start.y - absH : start.y;

                        const rect = await api.getPreciseSelection(
                            topLeftX * dpr,
                            topLeftY * dpr,
                            absW * dpr,
                            absH * dpr
                        );


                        if (rect) {
                            setPreciseRect({
                                x: rect.x / dpr,
                                y: rect.y / dpr,
                                w: rect.w / dpr,
                                h: rect.h / dpr
                            });
                        } else {
                            setPreciseRect(null);
                        }
                    } catch (err) {
                        // ignore
                    } finally {
                        isPreciseRequestPending = false;
                    }
                })();
            }
        } else {
            if (preciseRect()) setPreciseRect(null);
        }

        const x = isLeft ? start.x - snappedW : start.x;
        const y = isUp ? start.y - snappedH : start.y;

        setSelectionRect({ x, y, w: snappedW, h: snappedH });

        // === BOX SELECTION LOGIC ===
        if (isBoxSelecting()) {
             const selX = x;
             const selY = y;
             const selR = x + snappedW;
             const selB = y + snappedH;

             const newSelection: string[] = [];

             // Iterate cached rects for performance
             for (const u of cachedUnitRects) {
                 const uR = u.x + u.w;
                 const uB = u.y + u.h;
                 // AABB Intersection check
                 const intersects = !(selR < u.x || selX > uR || selB < u.y || selY > uB);
                 if (intersects) {
                     newSelection.push(u.id);
                 }
             }

             // Apply Selection
             // TODO: Shift key for "Additive" selection?
             // For now, simple replacement match standard behavior
             if (e.shiftKey) {
                 // Additive Logic (Union with what?)
                 // If we cached 'initialSelection', we could do Union(initial, new).
                 // Without cache, it's tricky.
                 // Let's just do simple set for now.
                 selectionActions.set(newSelection);
             } else {
                 selectionActions.set(newSelection);
             }
        }
    };

    const handleSelectionEnd = async () => {
        if (isBoxSelecting()) {
            setIsBoxSelecting(false);
            setSelectionRect(null);
            setStartPos(null);
            cachedUnitRects = [];
            return;
        }

        if (!isSelecting() || !selectionRect()) return;

        // Import check (handled by import in store/uiStore)
        // Need to import isCropping, selectedStickerId at top of file, or use accessor if available
        // Assuming they are imported below in the full file update
        const rect = preciseRect() || selectionRect()!;

        if (rect.w < 5 || rect.h < 5) {
            await api.setCaptureInputActive(false);
            void api.debugLogEvent("selection-end-small", `w=${rect.w} h=${rect.h}`);
            resetSelection();
            await api.setOverlayClickThrough(true);
            if (graphStore.units.length > 0) {
                await api.setMouseMonitorActive(true);
                await syncService.updateBackendRects();
            }
            return;
        }

        // CAPTURE
        setIsSelecting(false);
        void api.setCaptureInputActive(false);
        void api.debugLogEvent("selection-end", `x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h}`);

        const startX = rect.x;
        const startY = rect.y;

        // Wait for UI repaint (remove grey box)
        setTimeout(async () => {
             console.log("[Selection] Executing Capture for rect:", rect);
            try {
                await api.debugLogEvent("selection-capture-request", `x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h}`);
                const activeCaptureMode = captureMode();
                const isLongCapture = isLongCaptureMode(activeCaptureMode);
                if (isLongCapture) {
                    await api.debugLogEvent("selection-long-capture-prepare");
                    await startAutoLongCaptureSession(rect, { x: startX, y: startY });
                    return;
                }

                console.log("Requesting Capture:", rect);
                const response = await api.captureRegion(
                    Math.round(rect.x),
                    Math.round(rect.y),
                    Math.round(rect.w),
                    Math.round(rect.h)
                );
                await addCaptureUnit(response, rect, { x: startX, y: startY }, activeCaptureMode);
                resetSelection();
                await api.setOverlayClickThrough(true);
                await api.setMouseMonitorActive(true);
                await syncService.updateBackendRects();

            } catch (e) {
                console.error("Capture Failed", e);
                await api.setCaptureInputActive(false);
                await api.debugLogEvent("selection-capture-failure", e instanceof Error ? e.message : String(e));
                resetSelection();
                await api.setOverlayClickThrough(true);
                if (graphStore.units.length > 0) {
                    await api.setMouseMonitorActive(true);
                    await syncService.updateBackendRects();
                }
            }
        }, 50);

    };


    return {
        handleSelectionStart,
        handleSelectionMove,
        handleSelectionEnd,
        resetSelection,
        finishAutoLongCaptureSession,
        cancelAutoLongCaptureSession,
        notifyAutoLongCaptureWheel,
    };
}
