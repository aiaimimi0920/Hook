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
} from "./liveRelay";
import { liveRelayActions, liveRelayViews } from "../store/liveRelayStore";
import { liveRelayPointerDelayMs } from "./liveRelayInputQos";

const RETRY_MS = 500;
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
    const inputQueues = new Map<string, InputQueue>();
    let disposed = false;

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
        const bytes = await api.readLiveRelayFrame(relayId, frame.frameId);
        if (disposed || generations.get(relayId) !== generation) return;
        const bmp = encodeBgraAsBmp(bytes, frame.width, frame.height);
        const buffer = new ArrayBuffer(bmp.byteLength);
        new Uint8Array(buffer).set(bmp);
        const nextUrl = URL.createObjectURL(new Blob([buffer], { type: "image/bmp" }));
        const previousUrl = objectUrls.get(relayId);
        objectUrls.set(relayId, nextUrl);
        liveRelayActions.updateFrame(relayId, nextUrl, frame);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
    };

    const poll = async (relayId: string, generation: number): Promise<void> => {
        if (disposed || generations.get(relayId) !== generation) return;
        const view = liveRelayViews.find((candidate) => candidate.relayId === relayId);
        if (!view) return;
        try {
            if (view.status.role === "viewer") {
                const response = await api.pollLiveRelayFrame(relayId, view.renderedFrameId);
                liveRelayActions.updateStatus(relayId, response.status);
                if (response.frame && response.frame.frameId > view.renderedFrameId) {
                    try {
                        await updateFrame(relayId, response.frame, generation);
                    } catch (error) {
                        if (!String(error).includes("evicted")) throw error;
                    }
                }
            } else {
                liveRelayActions.updateStatus(relayId, await api.getLiveRelayStatus(relayId));
            }
            const current = liveRelayViews.find((candidate) => candidate.relayId === relayId);
            if (current?.status.connectionState === "closed") {
                releaseObjectUrl(relayId);
                liveRelayActions.clearFrame(relayId);
            } else {
                schedule(relayId, current?.status.role === "viewer" ? 80 : 400);
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
    ): void => {
        liveRelayActions.add(status, title, relayGeometry(source, liveRelayViews.length));
        generations.set(status.relayId, 1);
        inputQueues.set(status.relayId, {
            sequence: status.lastInputSequence,
            tail: Promise.resolve(),
            closed: false,
        });
        schedule(status.relayId, 0);
    };

    const discover = async (): Promise<void> => {
        const discovery = await api.discoverLiveRelaySessions();
        liveRelayActions.setDiscovery(discovery);
    };

    const publish = async (
        captureSessionId: string,
        title: string,
        size: { width: number; height: number },
        binding: LiveRelayBinding,
    ): Promise<void> => {
        const status = await api.publishLiveCaptureToLoom({
            captureSessionId,
            surfaceInstanceId: binding.instanceId,
            sourceAttachmentId: binding.attachmentId,
            sourceHookId: binding.unitId,
        });
        track(status, title, size);
        await discover();
    };

    const join = async (session: LiveRelaySessionSummary, binding: LiveRelayBinding): Promise<void> => {
        if (liveRelayViews.some((view) => view.status.liveSessionId === session.session.sessionId)) return;
        const status = await api.joinLiveRelaySession({
            liveSessionId: session.session.sessionId,
            surfaceInstanceId: binding.instanceId,
            attachmentId: binding.attachmentId,
        });
        track(status, titleFor(session), session.session.frameStream);
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
