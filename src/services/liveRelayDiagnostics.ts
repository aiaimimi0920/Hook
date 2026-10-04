import type { LiveRelayView } from './liveRelay';
import version from '../../version-state.json';

const count = (value: number | undefined): number | null =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const elapsed = (value: number | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const identity = (value: string | undefined): string | null =>
    typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,256}$/.test(value) ? value : null;

/** 固定单槽白名单：没有图像、标题、观察值、URL、错误正文或凭证，也不计算跨机帧龄。 */
export function liveRelayDiagnostic(view: LiveRelayView) {
    const status = view.status, submitted = view.presentation;
    const valid = !!view.imageUrl && view.relayId === status.relayId && status.connectionState !== 'closed'
        && submitted?.evidence === 'decoded_submitted' && submitted.liveSessionId === status.liveSessionId
        && submitted.epoch === status.epoch && submitted.frameId === view.submittedFrameId
        && count(submitted.frameId) !== null && submitted.frameId > 0;
    return {
        schemaVersion: 1,
        path: 'live_relay',
        buildVersion: `v${version.publicVersion}.${version.internalRevision}`,
        packageBinding: 'external_process_sha256_required',
        relayId: identity(view.relayId),
        liveSessionId: identity(status.liveSessionId),
        sourceDeviceId: identity(view.sourceIdentity?.deviceId),
        sourceHookId: identity(view.sourceIdentity?.hookId),
        connectionState: ['connecting', 'connected', 'recovering', 'closed'].includes(status.connectionState)
            ? status.connectionState : null,
        epoch: count(status.epoch),
        receivedFrames: count(status.receivedFrames),
        overwrittenFrames: count(status.overwrittenFrames),
        reconnectCount: count(status.reconnectCount),
        hasError: !!(view.controlError || status.errorCode),
        presentation: valid ? {
            evidence: 'decoded_submitted',
            generation: count(submitted.generation),
            frameId: count(submitted.frameId),
            width: count(view.frameWidth), height: count(view.frameHeight),
            codec: ['jpeg', 'raw_bgra'].includes(submitted.codec) ? submitted.codec : null,
            payloadBytes: count(submitted.payloadBytes), imageBytes: count(submitted.imageBytes),
            readMs: elapsed(submitted.readMs), prepareMs: elapsed(submitted.prepareMs), decodeMs: elapsed(submitted.decodeMs),
            submittedAtMs: elapsed(submitted.submittedAtMs),
            captureTimestampMs: count(submitted.captureTimestampMs), encodeTimestampMs: count(submitted.encodeTimestampMs),
            receivedTimestampMs: count(submitted.receivedTimestampMs),
        } : null,
    };
}
