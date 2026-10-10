import { api } from "./api";
import type { LiveCaptureInputPayload } from "./liveCapture";
import {
    createBgraBmpBlob,
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
    pendingMoveOwner?: () => boolean;
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
    let pairing: Promise<void> | undefined;
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
        const imageBlob = frame.codec === "jpeg"
            ? new Blob([bytes], { type: "image/jpeg" }) : createBgraBmpBlob(bytes, frame.width, frame.height);
        const preparedAt = performance.now();
        const decode = new AbortController();
        decodes.set(relayId, decode);
        let nextUrl: string;
        try {
            nextUrl = await decodeRelayImage(imageBlob, frame, decode.signal);
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
            evidence: "decoded_submitted", codec: frame.codec, payloadBytes: bytes.byteLength, imageBytes: imageBlob.size,
            readMs: readAt - startedAt, prepareMs: preparedAt - readAt,
            decodeMs: decodedAt - preparedAt, submittedAtMs: decodedAt,
        });
        liveRelayActions.setError(relayId);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
    };

    const renewViewer = async (relayId: string, status: LiveRelaySnapshot): Promise<void> => {
        if (status.role !== "viewer" || status.connectionState !== "closed"
            || status.errorCode !== "live_viewer_authorization_required"
            || Date.now() < (recoveryAfter.get(relayId) ?? 0)) return;
        recoveryAfter.set(relayId, Date.now() + 30_000);
        const generation = ++nextGeneration;
        generations.set(relayId, generation);
        decodes.get(relayId)?.abort();
        decodes.delete(relayId);
        releaseObjectUrl(relayId);
        liveRelayActions.clearFrame(relayId);
        const queue = inputQueues.get(relayId);
        if (queue) {
            queue.closed = true;
            queue.pendingMove = undefined;
            queue.pendingMoveOwner = undefined;
            if (queue.moveTimer !== undefined) window.clearTimeout(queue.moveTimer);
        }
        // Keep closed while awaiting renewal: new input and old-generation replies are fenced out.
        const isCurrent = (): boolean => {
            const current = liveRelayViews.find(view => view.relayId === relayId)?.status;
            return !disposed && generations.get(relayId) === generation && !!current
                && current.liveSessionId === status.liveSessionId && current.epoch === status.epoch
                && current.connectionState === "closed"
                && current.errorCode === "live_viewer_authorization_required";
        };
        try {
            const renewed = await api.reconnectLiveRelaySession(relayId);
            if (!isCurrent()) return;
            if (renewed.relayId !== relayId || renewed.liveSessionId !== status.liveSessionId
                || renewed.epoch !== status.epoch || renewed.role !== "viewer"
                || renewed.connectionState === "closed" || renewed.controllerOwned || renewed.remoteControlActive) {
                throw new Error("live_viewer_renewal_identity_or_authority_changed");
            }
            inputQueues.set(relayId, { sequence: renewed.lastInputSequence, tail: Promise.resolve(), closed: false });
            liveRelayActions.updateStatus(relayId, renewed);
            liveRelayActions.setError(relayId);
            schedule(relayId, 0);
        } catch {
            if (isCurrent()) liveRelayActions.setError(relayId, "观看续期失败，请关闭后重新加入。");
            // No closed-state polling or automatic retry after this attempt fails.
        }
    };

    const poll = async (relayId: string, generation: number): Promise<void> => {
        const terminal = liveRelayViews.find(view => view.relayId === relayId)?.status;
        if (!disposed && generations.get(relayId) === generation && terminal?.connectionState === "closed") {
            releaseObjectUrl(relayId);
            liveRelayActions.clearFrame(relayId);
            await renewViewer(relayId, terminal);
            return;
        }
        const isCurrent = (): boolean => {
            if (disposed || generations.get(relayId) !== generation) return false;
            const current = liveRelayViews.find((candidate) => candidate.relayId === relayId);
            if (!current) return false;
            // 控制响应也可确认终态；同一generation的迟到轮询/恢复不得将其复活。
            if (current.status.connectionState === "closed") {
                releaseObjectUrl(relayId);
                liveRelayActions.clearFrame(relayId);
                return false;
            }
            return true;
        };
        if (!isCurrent()) return;
        const view = liveRelayViews.find((candidate) => candidate.relayId === relayId);
        if (!view) return;
        const startedAt = performance.now();
        try {
            if (view.status.role === "viewer") {
                const response = await api.pollLiveRelayFrame(relayId, view.submittedFrameId);
                if (!isCurrent()) return;
                if (response.status.epoch !== view.status.epoch) {
                    releaseObjectUrl(relayId);
                    liveRelayActions.clearFrame(relayId);
                }
                liveRelayActions.updateStatus(relayId, response.status);
                if (response.status.connectionState === "closed") {
                    releaseObjectUrl(relayId);
                    liveRelayActions.clearFrame(relayId);
                    await renewViewer(relayId, response.status);
                    return;
                }
                if (response.frame && response.frame.frameId > view.submittedFrameId) {
                    try {
                        await updateFrame(relayId, response.frame, generation);
                    } catch (error) {
                        if (!String(error).includes("evicted")) throw error;
                    }
                }
            } else {
                let status = await api.getLiveRelayStatus(relayId);
                if (!isCurrent()) return;
                // 终态优先于残留的瞬态错误，不能因错误码重新发起源恢复。
                if (status.connectionState !== "closed"
                    && (status.connectionState === "recovering" || status.errorCode === "control_poll_failed")
                    && status.errorCode !== "source_recovery_unavailable"
                    && Date.now() >= (recoveryAfter.get(relayId) ?? 0)) {
                    recoveryAfter.set(relayId, Date.now() + 5000);
                    status = await api.reconnectLiveRelaySession(relayId);
                    if (!isCurrent()) return;
                }
                liveRelayActions.updateStatus(relayId, status);
            }
            if (!isCurrent()) return;
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
            if (!isCurrent()) return;
            liveRelayActions.setError(relayId, error instanceof Error ? error.message : String(error));
            schedule(relayId, RETRY_MS);
        } finally {
            // A concurrent control reply can close this owner while poll/read/decode is pending.
            const current = liveRelayViews.find(view => view.relayId === relayId)?.status;
            if (!disposed && generations.get(relayId) === generation && current?.connectionState === "closed") {
                await renewViewer(relayId, current);
            }
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

    const requestPairing = (): Promise<void> => {
        if (disposed) return Promise.reject(new Error("live relay owner is disposed"));
        if (pairing) return pairing;
        // Registration is explicit and shared across panels; it never discovers, joins or controls.
        pairing = api.requestLiveRelayPairing().then(() => {
            if (!disposed) liveRelayActions.setDiscovery({ protocolVersion: "loom.live.v1", sessions: [] });
        }).finally(() => { pairing = undefined; });
        return pairing;
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
        if (liveRelayViews.some((view) => view.status.liveSessionId === sessionId
            && view.status.connectionState !== "closed")) return;
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
        const isCurrent = controlOwnerIsCurrent(relayId);
        const queue = queueFor(relayId);
        const operation = queue.tail.then(async () => {
            if (queue.closed || !isCurrent()) return;
            // 丢弃旧 owner 的排队项不占用 native 要求连续的输入序号。
            const sequence = ++queue.sequence;
            const status = await api.sendLiveRelayInput(relayId, { ...payload, sequence });
            if (queue.closed || !isCurrent()) return;
            liveRelayActions.updateStatus(relayId, status);
            liveRelayActions.setError(relayId);
        });
        queue.tail = operation.catch((error) => {
            if (!queue.closed && isCurrent()) {
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
        const pendingOwner = queue.pendingMoveOwner;
        queue.pendingMove = undefined;
        queue.pendingMoveOwner = undefined;
        if (!pending || !pendingOwner?.()) return queue.tail;
        queue.lastMoveSentAtMs = Date.now();
        return enqueueInput(relayId, pending);
    };

    const sendInput = async (relayId: string, payload: LiveCaptureInputPayload): Promise<void> => {
        const isCurrent = controlOwnerIsCurrent(relayId);
        if (!isCurrent()) return;
        const queue = queueFor(relayId);
        if (payload.kind === "mouse_move") {
            queue.pendingMove = payload;
            // 合并槽中的最新坐标和归属一起替换，刷新不能把旧坐标转交给新epoch。
            queue.pendingMoveOwner = isCurrent;
            const latency = liveRelayViews.find((view) => view.relayId === relayId)
                ?.status.roundTripLatencyMs;
            const delay = liveRelayPointerDelayMs(queue.lastMoveSentAtMs, Date.now(), latency);
            queue.moveTimer ??= window.setTimeout(() => {
                queue.moveTimer = undefined;
                const pending = queue.pendingMove;
                const pendingOwner = queue.pendingMoveOwner;
                queue.pendingMove = undefined;
                queue.pendingMoveOwner = undefined;
                if (pending && pendingOwner?.()) {
                    queue.lastMoveSentAtMs = Date.now();
                    void enqueueInput(relayId, pending).catch(() => undefined);
                }
            }, delay);
            return;
        }
        await flushMove(relayId);
        // 等待旧队列期间可能已停止并复用relayId，不能把旧按键送入新owner。
        if (!isCurrent()) return;
        await enqueueInput(relayId, payload);
    };

    const controlOwnerIsCurrent = (relayId: string, checkEpoch = true): (() => boolean) => {
        const generation = generations.get(relayId);
        const status = liveRelayViews.find((view) => view.relayId === relayId)?.status;
        const sessionId = status?.liveSessionId;
        const epoch = status?.epoch;
        // relayId可被后续owner复用；异步完成必须仍属于同一代、会话和epoch。
        return () => {
            const current = liveRelayViews.find((view) => view.relayId === relayId)?.status;
            return !disposed && generation !== undefined && generations.get(relayId) === generation
                && !!current && current.connectionState !== "closed"
                && current.liveSessionId === sessionId && (!checkEpoch || current.epoch === epoch);
        };
    };

    const changeController = async (relayId: string, acquire: boolean): Promise<void> => {
        const isCurrent = controlOwnerIsCurrent(relayId, acquire);
        if (!isCurrent()) return;
        const queue = queueFor(relayId);
        if (!acquire) await flushMove(relayId);
        if (!isCurrent()) return;
        // 显式 release 跨过排队输入带来的 epoch 更新，但返回仍绑定实际发请求时的 epoch。
        const requestIsCurrent = controlOwnerIsCurrent(relayId);
        const status = await api.changeLiveRelayController(
            relayId,
            acquire ? "acquire" : "release",
            acquire ? 30_000 : undefined,
        );
        if (!requestIsCurrent()) return;
        queue.sequence = Math.max(queue.sequence, status.lastInputSequence);
        liveRelayActions.updateStatus(relayId, status);
        liveRelayActions.setError(relayId);
    };

    const reclaim = async (relayId: string): Promise<void> => {
        const isCurrent = controlOwnerIsCurrent(relayId);
        if (!isCurrent()) return;
        const status = await api.reclaimLiveRelayControl(relayId);
        if (!isCurrent()) return;
        liveRelayActions.updateStatus(relayId, status);
        liveRelayActions.setError(relayId);
    };

    const configureTrigger = async (request: LiveRelayTriggerConfigureRequest): Promise<void> => {
        const isCurrent = controlOwnerIsCurrent(request.relayId);
        if (!isCurrent()) return;
        const status = await api.configureLiveRelayTrigger(request);
        if (!isCurrent()) return;
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
            queue.pendingMoveOwner = undefined;
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
                queue.pendingMoveOwner = undefined;
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
        requestPairing,
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
