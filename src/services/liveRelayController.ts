import { api } from "./api";
import type { LiveCaptureInputPayload } from "./liveCapture";
import {
    encodeBgraAsBmp,
    relayGeometry,
    type LiveRelayBinding,
    type LiveRelayFrameDescriptor,
    type LiveRelaySessionSummary,
    type LiveRelaySnapshot,
    type LiveRelayTriggerConfigureRequest,
    type LiveRelayView,
} from "./liveRelay";
import { liveRelayActions, liveRelayViews } from "../store/liveRelayStore";
import { liveRelayPointerDelayMs } from "./liveRelayInputQos";
import { decodeRelayImage, validateRelayPresentationFrame } from "./liveRelayPresentation";

const RETRY_MS = 500;
const VIEWER_POLL_INTERVAL_MS = 80;
const INPUT_DRAIN_TIMEOUT_MS = 1_000;

type InputQueue = {
    sequence: number;
    tail: Promise<void>;
    pendingMove?: LiveCaptureInputPayload;
    moveTimer?: number;
    lastMoveSentAtMs?: number;
    closed: boolean;
};

export function createLiveRelayController() {
    const timers = new Map<string, number>();
    const generations = new Map<string, number>();
    const objectUrls = new Map<string, string>();
    const decodes = new Map<string, AbortController>();
    const inputQueues = new Map<string, InputQueue>();
    const recoveryAfter = new Map<string, number>();
    const publications = new Map<string, Promise<void>>();
    const joins = new Set<string>();
    let disposed = false;
    let nextGeneration = 0;

    const releaseObjectUrl = (relayId: string): void => {
        const objectUrl = objectUrls.get(relayId);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrls.delete(relayId);
    };

    const titleFor = (session?: LiveRelaySessionSummary): string =>
        session?.session.sourceWindowIdentity.title
        ?? session?.session.sourceHookId
        ?? "远端实时画面";

    const schedule = (relayId: string, delay = 100): void => {
        if (disposed || !generations.has(relayId)) return;
        const timer = window.setTimeout(() => {
            timers.delete(relayId);
            void poll(relayId, generations.get(relayId) ?? 0);
        }, delay);
        timers.set(relayId, timer);
    };

    const updateFrame = async (
        relayId: string,
        frame: LiveRelayFrameDescriptor,
        generation: number,
    ): Promise<void> => {
        const view = liveRelayViews.find((candidate) => candidate.relayId === relayId);
        if (!view) return;
        validateRelayPresentationFrame(frame, view.status);
        const startedAt = performance.now();
        const bytes = await api.readLiveRelayFrame(relayId, frame.frameId);
        if (disposed || generations.get(relayId) !== generation) return;
        const readAt = performance.now();
        if (bytes.byteLength !== frame.byteLength) throw new Error("live_relay_payload_length_mismatch");
        const imageBytes = frame.codec === "jpeg" ? bytes : encodeBgraAsBmp(bytes, frame.width, frame.height);
        const preparedAt = performance.now();
        const decode = new AbortController();
        decodes.set(relayId, decode);
        let nextUrl: string;
        try {
            nextUrl = await decodeRelayImage(imageBytes, frame, decode.signal);
        } finally {
            if (decodes.get(relayId) === decode) decodes.delete(relayId);
        }
        const decodedAt = performance.now();
        const current = liveRelayViews.find((candidate) => candidate.relayId === relayId);
        if (disposed || generations.get(relayId) !== generation || !current
            || current.status.connectionState === "closed" || current.status.epoch !== frame.epoch
            || current.status.liveSessionId !== frame.liveSessionId) {
            URL.revokeObjectURL(nextUrl);
            return;
        }
        const previousUrl = objectUrls.get(relayId);
        objectUrls.set(relayId, nextUrl);
        liveRelayActions.updateFrame(relayId, nextUrl, frame, {
            liveSessionId: frame.liveSessionId, epoch: frame.epoch, frameId: frame.frameId,
            generation, captureTimestampMs: frame.captureTimestampMs, encodeTimestampMs: frame.encodeTimestampMs,
            receivedTimestampMs: frame.receivedTimestampMs,
            evidence: "decoded_submitted", codec: frame.codec, payloadBytes: bytes.byteLength, imageBytes: imageBytes.byteLength,
            readMs: readAt - startedAt, prepareMs: preparedAt - readAt,
            decodeMs: decodedAt - preparedAt, submittedAtMs: decodedAt,
        });
        liveRelayActions.setError(relayId);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
    };

    const poll = async (relayId: string, generation: number): Promise<void> => {
        if (disposed || generations.get(relayId) !== generation) return;
        const view = liveRelayViews.find((candidate) => candidate.relayId === relayId);
        if (!view) return;
        const startedAt = performance.now();
        try {
            if (view.status.role === "viewer") {
                const response = await api.pollLiveRelayFrame(relayId, view.submittedFrameId);
                if (disposed || generations.get(relayId) !== generation) return;
                if (response.status.epoch !== view.status.epoch) {
                    releaseObjectUrl(relayId);
                    liveRelayActions.clearFrame(relayId);
                }
                liveRelayActions.updateStatus(relayId, response.status);
                if (response.status.connectionState !== "closed"
                    && response.frame && response.frame.frameId > view.submittedFrameId) {
                    try {
                        await updateFrame(relayId, response.frame, generation);
                    } catch (error) {
                        if (!String(error).includes("evicted")) throw error;
                    }
                }
            } else {
                let status = await api.getLiveRelayStatus(relayId);
                if (disposed || generations.get(relayId) !== generation) return;
                if ((status.connectionState === "recovering" || status.errorCode === "control_poll_failed")
                    && status.errorCode !== "source_recovery_unavailable"
                    && Date.now() >= (recoveryAfter.get(relayId) ?? 0)) {
                    recoveryAfter.set(relayId, Date.now() + 5000);
                    status = await api.reconnectLiveRelaySession(relayId);
                    if (disposed || generations.get(relayId) !== generation) return;
                }
                liveRelayActions.updateStatus(relayId, status);
            }
            const current = liveRelayViews.find((candidate) => candidate.relayId === relayId);
            if (current?.status.connectionState === "closed") {
                releaseObjectUrl(relayId);
                liveRelayActions.clearFrame(relayId);
            } else {
                // IPC、BMP 和有界解码共用帧预算；每个 viewer 只保留一个在途候选。
                const delay = current?.status.role === "viewer"
                    ? Math.max(1, VIEWER_POLL_INTERVAL_MS - (performance.now() - startedAt))
                    : 400;
                schedule(relayId, delay);
            }
        } catch (error) {
            if (disposed || generations.get(relayId) !== generation) return;
            liveRelayActions.setError(relayId, error instanceof Error ? error.message : String(error));
            schedule(relayId, RETRY_MS);
        }
    };

    const track = (
        status: LiveRelaySnapshot,
        title: string,
        source: { width: number; height: number },
        sourceIdentity?: LiveRelayView["sourceIdentity"],
    ): void => {
        liveRelayActions.add(status, title, relayGeometry(source, liveRelayViews.length), sourceIdentity);
        generations.set(status.relayId, ++nextGeneration);
        inputQueues.set(status.relayId, {
            sequence: status.lastInputSequence,
            tail: Promise.resolve(),
            closed: false,
        });
        schedule(status.relayId, 0);
    };

    const discover = async (): Promise<void> => {
        if (disposed) return;
        const discovery = await api.discoverLiveRelaySessions();
        if (!disposed) liveRelayActions.setDiscovery(discovery);
    };

    const publish = async (
        captureSessionId: string,
        title: string,
        size: { width: number; height: number },
        binding?: LiveRelayBinding,
    ): Promise<void> => {
        if (disposed) throw new Error("live relay owner is disposed");
        const pending = publications.get(captureSessionId);
        if (pending) return pending;
        if (liveRelayViews.some((view) => view.status.role === "source" && view.status.captureSessionId === captureSessionId)) return;
        if (publications.size >= 4) throw new Error("live_relay_publication_limit");
        const operation = Promise.resolve().then(async () => {
            if (disposed) return;
            const status = await api.publishLiveCaptureToLoom({
                captureSessionId,
                surfaceInstanceId: binding?.instanceId,
                sourceAttachmentId: binding?.attachmentId,
                sourceHookId: binding?.unitId ?? captureSessionId,
            });
            if (disposed) { await api.stopLiveRelaySession(status.relayId); return; }
            track(status, title, size);
            // A catalog refresh failure does not undo an already successful publication.
            await discover().catch((error: unknown) => {
                if (!disposed) liveRelayActions.setError(status.relayId, error instanceof Error ? error.message : String(error));
            });
        }).finally(() => { publications.delete(captureSessionId); });
        publications.set(captureSessionId, operation);
        return operation;
    };

    const join = async (
        session: LiveRelaySessionSummary,
        binding: LiveRelayBinding,
        stillCurrent: () => boolean = () => true,
    ): Promise<void> => {
        if (disposed || !stillCurrent()) return;
        const sessionId = session.session.sessionId;
        if (session.closed) throw new Error("实时投射已关闭，请刷新列表");
        if (liveRelayViews.some((view) => view.status.liveSessionId === sessionId)) return;
        if (joins.has(sessionId)) throw new Error("正在加入此实时投射，请稍候");
        if (joins.size >= 4) throw new Error("同时加入的请求过多，请稍后重试");
        joins.add(sessionId);
        try {
            const status = await api.joinLiveRelaySession({
                liveSessionId: sessionId,
                surfaceInstanceId: binding.instanceId,
                attachmentId: binding.attachmentId,
            });
            // 面板关闭或绑定换代只取消本次未完成的加入，不影响已打开的观看窗口。
            if (disposed || !stillCurrent()) {
                await api.stopLiveRelaySession(status.relayId);
                return;
            }
            track(status, titleFor(session), session.session.frameStream, {
                deviceId: session.session.sourceDeviceId, hookId: session.session.sourceHookId,
            });
        } finally {
            joins.delete(sessionId);
        }
    };

    const queueFor = (relayId: string): InputQueue => {
        const queue = inputQueues.get(relayId);
        if (!queue) throw new Error("live relay input queue is unavailable");
        return queue;
    };

    const enqueueInput = (relayId: string, payload: LiveCaptureInputPayload): Promise<void> => {
        const queue = queueFor(relayId);
        queue.sequence += 1;
        const sequence = queue.sequence;
        const operation = queue.tail.then(async () => {
            if (queue.closed) return;
            const status = await api.sendLiveRelayInput(relayId, { ...payload, sequence });
            if (queue.closed) return;
            liveRelayActions.updateStatus(relayId, status);
            liveRelayActions.setError(relayId);
        });
        queue.tail = operation.catch((error) => {
            if (!queue.closed) {
                liveRelayActions.setError(relayId, error instanceof Error ? error.message : String(error));
            }
        });
        return operation;
    };

    const flushMove = (relayId: string): Promise<void> => {
        const queue = queueFor(relayId);
        if (queue.moveTimer !== undefined) window.clearTimeout(queue.moveTimer);
        queue.moveTimer = undefined;
        const pending = queue.pendingMove;
        queue.pendingMove = undefined;
        if (!pending) return queue.tail;
        queue.lastMoveSentAtMs = Date.now();
        return enqueueInput(relayId, pending);
    };

    const sendInput = async (relayId: string, payload: LiveCaptureInputPayload): Promise<void> => {
        const queue = queueFor(relayId);
        if (payload.kind === "mouse_move") {
            queue.pendingMove = payload;
            const latency = liveRelayViews.find((view) => view.relayId === relayId)
                ?.status.roundTripLatencyMs;
            const delay = liveRelayPointerDelayMs(queue.lastMoveSentAtMs, Date.now(), latency);
            queue.moveTimer ??= window.setTimeout(() => {
                queue.moveTimer = undefined;
                const pending = queue.pendingMove;
                queue.pendingMove = undefined;
                if (pending) {
                    queue.lastMoveSentAtMs = Date.now();
                    void enqueueInput(relayId, pending).catch(() => undefined);
                }
            }, delay);
            return;
        }
        await flushMove(relayId);
        await enqueueInput(relayId, payload);
    };

    const changeController = async (relayId: string, acquire: boolean): Promise<void> => {
        const queue = queueFor(relayId);
        if (!acquire) await flushMove(relayId);
        const status = await api.changeLiveRelayController(
            relayId,
            acquire ? "acquire" : "release",
            acquire ? 30_000 : undefined,
        );
        queue.sequence = Math.max(queue.sequence, status.lastInputSequence);
        liveRelayActions.updateStatus(relayId, status);
        liveRelayActions.setError(relayId);
    };

    const reclaim = async (relayId: string): Promise<void> => {
        const status = await api.reclaimLiveRelayControl(relayId);
        liveRelayActions.updateStatus(relayId, status);
        liveRelayActions.setError(relayId);
    };

    const configureTrigger = async (request: LiveRelayTriggerConfigureRequest): Promise<void> => {
        const status = await api.configureLiveRelayTrigger(request);
        liveRelayActions.updateStatus(request.relayId, status);
        liveRelayActions.setError(request.relayId);
    };

    const stop = async (relayId: string): Promise<void> => {
        generations.delete(relayId);
        decodes.get(relayId)?.abort();
        decodes.delete(relayId);
        recoveryAfter.delete(relayId);
        const timer = timers.get(relayId);
        if (timer !== undefined) window.clearTimeout(timer);
        const queue = inputQueues.get(relayId);
        if (queue?.moveTimer !== undefined) window.clearTimeout(queue.moveTimer);
        if (queue) {
            queue.closed = true;
            queue.pendingMove = undefined;
            let drainTimer: number | undefined;
            await Promise.race([
                queue.tail,
                new Promise<void>((resolve) => {
                    drainTimer = window.setTimeout(resolve, INPUT_DRAIN_TIMEOUT_MS);
                }),
            ]);
            if (drainTimer !== undefined) window.clearTimeout(drainTimer);
        }
        inputQueues.delete(relayId);
        timers.delete(relayId);
        releaseObjectUrl(relayId);
        liveRelayActions.remove(relayId);
        await api.stopLiveRelaySession(relayId);
    };

    const dispose = (): void => {
        disposed = true;
        for (const decode of decodes.values()) decode.abort();
        decodes.clear();
        for (const view of [...liveRelayViews]) {
            const timer = timers.get(view.relayId);
            if (timer !== undefined) window.clearTimeout(timer);
            const objectUrl = objectUrls.get(view.relayId);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            const queue = inputQueues.get(view.relayId);
            if (queue) {
                queue.closed = true;
                queue.pendingMove = undefined;
                if (queue.moveTimer !== undefined) window.clearTimeout(queue.moveTimer);
            }
            void api.stopLiveRelaySession(view.relayId).catch(() => undefined);
        }
        timers.clear();
        generations.clear();
        inputQueues.clear();
        recoveryAfter.clear();
        objectUrls.clear();
        liveRelayActions.clear();
    };

    return {
        discover,
        publish,
        join,
        sendInput,
        changeController,
        reclaim,
        configureTrigger,
        stop,
        dispose,
    };
}

export type LiveRelayController = ReturnType<typeof createLiveRelayController>;
