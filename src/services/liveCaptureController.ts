import { createEffect, createRoot, untrack } from "solid-js";
import { api as nativeApi, isTauriRuntimeAvailable } from "./api";
import { graphStore } from "../store/graphStore";
import { attachLiveCaptureUnit, detachLiveCaptureUnit, prepareLiveCaptureUnitSnapshot,
    updateLiveCaptureUnitFrame } from "./liveCaptureUnit";
import {
    initialLiveViewGeometry,
    type LiveCaptureInputPayload,
    type LiveCaptureSelection,
    type LiveCaptureStatus,
} from "./liveCapture";
import { liveCaptureActions, liveCaptureViews } from "../store/liveCaptureStore";
import { showLiveCaptureControlError } from "./liveCaptureFeedback";
import { createLiveCaptureStatusFeedback } from "./liveCaptureStatusFeedback";
import { createLiveCapturePollCadence } from "./liveCapturePollCadence";
import { decodeLiveFrame, liveFrameDelay, LIVE_CAPTURE_TARGET_FPS } from "./liveCapturePresentation";
import { readLiveGpuSnapshot } from "./liveGpuSnapshot";
import { registerLiveCaptureHandoff, unregisterLiveCaptureHandoff, waitForLiveFallbackPaint } from "./liveCaptureHandoff";

const POLL_RETRY_MS = 500;

type InputQueue = {
    sequence: number;
    tail: Promise<void>;
    pendingMove?: LiveCaptureInputPayload;
    animationFrame?: number;
};

export type LiveCaptureBackend = Pick<typeof nativeApi, "startLiveCapture" | "stopLiveCapture"
    | "pollLiveCaptureFrame" | "readLiveCaptureFrame" | "sendLiveCaptureInput"
    | "setLiveCaptureSourceHidden" | "setLiveCaptureInteractionEnabled">;

export function createLiveCaptureController(api: LiveCaptureBackend = nativeApi) {
    const captureFeedback = createLiveCaptureStatusFeedback();
    const pollCadence = createLiveCapturePollCadence();
    const timers = new Map<string, number>();
    const generations = new Map<string, number>();
    const objectUrls = new Map<string, string>();
    const presentedAt = new Map<string, { at: number; mime: string }>();
    const inputQueues = new Map<string, InputQueue>();
    const stopping = new Map<string, Promise<void>>();
    let disposed = false;

    const reportControlError = (sessionId: string, error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const code = message.split(":", 1)[0] || "live_control_failed";
        liveCaptureActions.setControlError(sessionId, code, message);
        showLiveCaptureControlError(sessionId, code);
    };

    const schedule = (status: LiveCaptureStatus, delay?: number) => {
        if (disposed || !generations.has(status.sessionId)) return;
        const previous = timers.get(status.sessionId);
        if (previous !== undefined) window.clearTimeout(previous);
        const waitMs = delay ?? liveFrameDelay(status.targetFps);
        const timer = window.setTimeout(() => {
            timers.delete(status.sessionId);
            void poll(status.sessionId, generations.get(status.sessionId) ?? 0);
        }, waitMs);
        timers.set(status.sessionId, timer);
    };

    const publishPixels = async (
        sessionId: string,
        bytes: Uint8Array<ArrayBuffer>, mime: string, frameId: number, capturedAtMs: number,
        generation: number,
    ) => {
        if (disposed || generations.get(sessionId) !== generation) return;
        const nextUrl = await decodeLiveFrame(bytes, mime);
        if (disposed || generations.get(sessionId) !== generation) {
            URL.revokeObjectURL(nextUrl);
            return;
        }
        // An in-flight JPEG must not replace a newer GPU-to-DOM handoff.
        const previous = presentedAt.get(sessionId);
        if (previous && (capturedAtMs < previous.at
            || (capturedAtMs === previous.at && previous.mime === "image/png" && mime === "image/jpeg"))) {
            URL.revokeObjectURL(nextUrl);
            return;
        }
        const previousUrl = objectUrls.get(sessionId);
        objectUrls.set(sessionId, nextUrl);
        presentedAt.set(sessionId, { at: capturedAtMs, mime });
        const renderedId = liveCaptureViews.find((view) => view.sessionId === sessionId)?.renderedFrameId ?? 0;
        liveCaptureActions.updateFrame(sessionId, nextUrl, Math.max(renderedId, frameId));
        updateLiveCaptureUnitFrame(sessionId, bytes, mime, frameId, capturedAtMs);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
    };

    const publishFrame = async (
        sessionId: string,
        frame: NonNullable<Awaited<ReturnType<typeof api.pollLiveCaptureFrame>>["frame"]>,
        generation: number,
    ) => {
        const bytes = await api.readLiveCaptureFrame(sessionId, frame.frameId);
        if (bytes.byteLength !== frame.byteLength) throw new Error("live frame byte length mismatch");
        await publishPixels(sessionId, bytes, frame.mime, frame.frameId, frame.captureTimestampMs, generation);
        const current = liveCaptureViews.find((view) => view.sessionId === sessionId);
        const url = objectUrls.get(sessionId);
        if (!disposed && generations.get(sessionId) === generation && url && current
            && frame.frameId > current.renderedFrameId) {
            // A stale JPEG was consumed, even if a newer PNG stayed visible.
            liveCaptureActions.updateFrame(sessionId, url, frame.frameId);
        }
    };

    const poll = async (sessionId: string, generation: number): Promise<void> => {
        if (disposed || generations.get(sessionId) !== generation) return;
        const view = liveCaptureViews.find((candidate) => candidate.sessionId === sessionId);
        if (!view) return;
        const startedAt = performance.now();
        try {
            const response = await api.pollLiveCaptureFrame(sessionId, view.renderedFrameId);
            if (disposed || generations.get(sessionId) !== generation) return;
            liveCaptureActions.updateStatus(sessionId, response.status);
            if (response.frame && response.frame.frameId > view.renderedFrameId) {
                try {
                    await publishFrame(sessionId, response.frame, generation);
                } catch (error) {
                    if (!String(error).includes("evicted")) throw error;
                }
            }
            captureFeedback.observe(response.status);
            if (response.status.captureState !== "closed" && response.status.captureState !== "failed") {
                schedule(response.status, pollCadence.delay(sessionId, response.status.targetFps, performance.now() - startedAt));
            }
        } catch (error) {
            if (disposed || generations.get(sessionId) !== generation) return;
            const current = liveCaptureViews.find((candidate) => candidate.sessionId === sessionId);
            if (!current) return;
            const recovering: LiveCaptureStatus = {
                ...current.status,
                captureState: "recovering",
                visibilityState: "capture_recovering",
                errorCode: "ipc_poll_failed",
                errorMessage: error instanceof Error ? error.message : String(error),
            };
            liveCaptureActions.updateStatus(sessionId, recovering);
            captureFeedback.observe(recovering);
            schedule(current.status, POLL_RETRY_MS);
        }
    };

    const inputQueue = (sessionId: string): InputQueue => {
        const existing = inputQueues.get(sessionId);
        if (existing) return existing;
        const created: InputQueue = { sequence: 0, tail: Promise.resolve() };
        inputQueues.set(sessionId, created);
        return created;
    };

    const enqueueInput = (sessionId: string, payload: LiveCaptureInputPayload): Promise<void> => {
        const queue = inputQueue(sessionId);
        queue.sequence += 1;
        const sequence = queue.sequence;
        const operation = queue.tail.then(() => api.sendLiveCaptureInput(sessionId, {
            ...payload,
            sequence,
        }));
        queue.tail = operation.catch((error) => reportControlError(sessionId, error));
        return operation;
    };

    const flushPendingMove = (sessionId: string): Promise<void> => {
        const queue = inputQueue(sessionId);
        if (queue.animationFrame !== undefined) {
            window.cancelAnimationFrame(queue.animationFrame);
            queue.animationFrame = undefined;
        }
        const pending = queue.pendingMove;
        queue.pendingMove = undefined;
        return pending ? enqueueInput(sessionId, pending) : queue.tail;
    };

    const sendInput = async (sessionId: string, payload: LiveCaptureInputPayload): Promise<void> => {
        if (disposed || !generations.has(sessionId)) return;
        const queue = inputQueue(sessionId);
        if (payload.kind === "mouse_move") {
            queue.pendingMove = payload;
            if (queue.animationFrame === undefined) {
                queue.animationFrame = window.requestAnimationFrame(() => {
                    queue.animationFrame = undefined;
                    const pending = queue.pendingMove;
                    queue.pendingMove = undefined;
                    if (pending) void enqueueInput(sessionId, pending).catch(() => undefined);
                });
            }
            return;
        }
        // Reserve move and edge positions together, before yielding. Awaiting the
        // move first lets later gestures overtake this button/key edge.
        void flushPendingMove(sessionId).catch(() => undefined);
        await enqueueInput(sessionId, payload);
    };

    const start = async (selection: LiveCaptureSelection): Promise<void> => {
        const status = await api.startLiveCapture({
            windowId: selection.windowId,
            sourceTitle: selection.sourceTitle,
            windowRegion: selection.windowRegion
                ? {
                    x: selection.windowRegion.x,
                    y: selection.windowRegion.y,
                    width: selection.windowRegion.w,
                    height: selection.windowRegion.h,
                }
                : undefined,
            x: Math.round(selection.rect.x),
            y: Math.round(selection.rect.y),
            width: Math.round(selection.rect.w),
            height: Math.round(selection.rect.h),
            targetFps: LIVE_CAPTURE_TARGET_FPS,
        });
        if (disposed) {
            await api.stopLiveCapture(status.sessionId);
            return;
        }
        if (isTauriRuntimeAvailable()) {
            // Record the actual source semantics, not page titles, URLs or grants.
            void nativeApi.debugLogEvent("live_capture_source_bound",
                `source=${status.sourceKind} width=${status.width} height=${status.height}`)
                .catch(() => undefined);
        }
        liveCaptureActions.add(status, initialLiveViewGeometry(
            { width: selection.rect.w, height: selection.rect.h },
            { width: window.innerWidth, height: window.innerHeight },
            { x: selection.rect.x, y: selection.rect.y },
        ));
        generations.set(status.sessionId, 1);
        pollCadence.register(status.sessionId, () => {
            // An in-flight poll will choose the new cadence when it completes.
            if (!timers.has(status.sessionId)) return;
            const current = liveCaptureViews.find((view) => view.sessionId === status.sessionId);
            if (current) schedule(current.status, 0);
        });
        registerLiveCaptureHandoff(status.sessionId, async () => {
            const snapshot = await readLiveGpuSnapshot(status.sessionId);
            if (!snapshot) return;
            const frameId = liveCaptureViews.find((view) => view.sessionId === status.sessionId)?.renderedFrameId ?? 0;
            await publishPixels(status.sessionId, snapshot.bytes, "image/png", frameId, snapshot.capturedAtMs, 1);
            if (!disposed && generations.has(status.sessionId)) await waitForLiveFallbackPaint();
        });
        inputQueue(status.sessionId);
        const view = liveCaptureViews.find((item) => item.sessionId === status.sessionId);
        if (view) attachLiveCaptureUnit(view, (input) => sendInput(status.sessionId, input));
        captureFeedback.observe(status);
        if (status.inputCapability === "window_message") {
            try {
                const interactiveStatus = await api.setLiveCaptureInteractionEnabled(status.sessionId, true);
                liveCaptureActions.updateStatus(status.sessionId, interactiveStatus);
            } catch (error) {
                reportControlError(status.sessionId, error);
            }
        } else {
            showLiveCaptureControlError(status.sessionId, status.inputCapability);
        }
        schedule(status, 0);
    };

    const setSourceHidden = async (sessionId: string, hidden: boolean): Promise<void> => {
        try {
            const status = await api.setLiveCaptureSourceHidden(sessionId, hidden);
            liveCaptureActions.updateStatus(sessionId, status);
            liveCaptureActions.setControlError(sessionId);
        } catch (error) {
            reportControlError(sessionId, error);
            throw error;
        }
    };

    const setInteractionEnabled = async (sessionId: string, enabled: boolean): Promise<void> => {
        const queue = inputQueue(sessionId);
        if (!enabled) {
            queue.pendingMove = undefined;
            if (queue.animationFrame !== undefined) window.cancelAnimationFrame(queue.animationFrame);
            queue.animationFrame = undefined;
            await queue.tail;
        }
        try {
            const status = await api.setLiveCaptureInteractionEnabled(sessionId, enabled);
            liveCaptureActions.updateStatus(sessionId, status);
            liveCaptureActions.setControlError(sessionId);
        } catch (error) {
            reportControlError(sessionId, error);
            throw error;
        }
    };

    const reclaim = async (sessionId: string): Promise<void> => {
        let firstError: unknown;
        try {
            await setInteractionEnabled(sessionId, false);
        } catch (error) {
            firstError = error;
        }
        try {
            await setSourceHidden(sessionId, false);
        } catch (error) {
            firstError ??= error;
        }
        if (firstError) throw firstError;
    };

    const stop = (sessionId: string): Promise<void> => {
        const pending = stopping.get(sessionId);
        if (pending) return pending;
        if (!generations.has(sessionId)) return Promise.resolve();
        generations.delete(sessionId);
        captureFeedback.forget(sessionId);
        pollCadence.forget(sessionId);
        unregisterLiveCaptureHandoff(sessionId);
        const timer = timers.get(sessionId);
        if (timer !== undefined) window.clearTimeout(timer);
        timers.delete(sessionId);
        const queue = inputQueues.get(sessionId);
        if (queue?.animationFrame !== undefined) window.cancelAnimationFrame(queue.animationFrame);
        if (queue) queue.pendingMove = undefined;
        const operation = (async () => {
            let failure: unknown;
            try {
                await queue?.tail;
                // Keep the native plane/session alive until the retained sticker
                // owns its last frame. Graph deletion needs cleanup, not readback.
                if (!disposed && graphStore.units.some((unit) => unit.id === sessionId)) {
                    const snapshot = prepareLiveCaptureUnitSnapshot(sessionId);
                    if (snapshot) await snapshot;
                }
            } catch (error) {
                failure = error;
            }
            try {
                detachLiveCaptureUnit(sessionId);
                inputQueues.delete(sessionId);
                const objectUrl = objectUrls.get(sessionId);
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                objectUrls.delete(sessionId);
                presentedAt.delete(sessionId);
                liveCaptureActions.remove(sessionId);
                try {
                    await api.stopLiveCapture(sessionId);
                } catch (error) {
                    if (!String(error).includes("not found")) failure ??= error;
                }
            } finally {
                stopping.delete(sessionId);
            }
            if (failure) throw failure;
        })();
        stopping.set(sessionId, operation);
        return operation;
    };

    const dispose = (): void => {
        disposed = true;
        disposeUnitObserver();
        const sessionIds = [...generations.keys()];
        sessionIds.forEach((sessionId) => {
            unregisterLiveCaptureHandoff(sessionId);
            detachLiveCaptureUnit(sessionId);
            const timer = timers.get(sessionId);
            if (timer !== undefined) window.clearTimeout(timer);
            const queue = inputQueues.get(sessionId);
            if (queue?.animationFrame !== undefined) window.cancelAnimationFrame(queue.animationFrame);
            const objectUrl = objectUrls.get(sessionId);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            void api.stopLiveCapture(sessionId).catch(() => undefined);
        });
        // App teardown cannot await a readback. Invalidate its binding now;
        // the already-owned stop operation still releases the native session.
        for (const [sessionId, operation] of stopping) {
            detachLiveCaptureUnit(sessionId);
            const objectUrl = objectUrls.get(sessionId);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            void operation.catch(() => undefined);
        }
        timers.clear();
        generations.clear();
        captureFeedback.clear();
        pollCadence.clear();
        inputQueues.clear();
        objectUrls.clear();
        presentedAt.clear();
        // Dispose only this controller's sessions; other owners may still be active.
        for (const sessionId of [...sessionIds, ...stopping.keys()]) liveCaptureActions.remove(sessionId);
    };

    const disposeUnitObserver = createRoot((disposeObserver) => {
        createEffect(() => {
            const ids = new Set(graphStore.units.map((unit) => unit.id));
            untrack(() => {
                for (const sessionId of generations.keys()) {
                    if (!ids.has(sessionId)) void stop(sessionId).catch(() => undefined);
                }
            });
        });
        return disposeObserver;
    });

    return { start, stop, dispose, setSourceHidden, setInteractionEnabled, sendInput, reclaim };
}

export type LiveCaptureController = ReturnType<typeof createLiveCaptureController>;
