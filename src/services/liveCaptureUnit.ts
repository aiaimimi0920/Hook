import { graphStore } from "../store/graphStore";
import { activeStickerEditTargetId, selectionActions } from "../store/uiStore";
import type { LiveCaptureInputPayload, LiveCaptureView } from "./liveCapture";
import { readLiveGpuSnapshot } from "./liveGpuSnapshot";

type LiveUnitBinding = {
    sendInput: (input: LiveCaptureInputPayload) => Promise<void>;
    frame?: Uint8Array;
    mime?: string;
    frameId?: number;
    committedFrameId?: number;
    committedAtMs?: number;
    frameCapturedAtMs?: number;
    snapshotAtMs?: number;
    snapshot?: Promise<string | undefined>;
};

// Only explicit snapshot boundaries copy media into graph data. Streaming bytes
// and session capabilities never become serialized Unit fields.
const bindings = new Map<string, LiveUnitBinding>();

export function attachLiveCaptureUnit(
    view: LiveCaptureView,
    sendInput: LiveUnitBinding["sendInput"],
): void {
    bindings.set(view.sessionId, { sendInput });
    graphStore.actions.addUnit({
        id: view.sessionId,
        type: "sticker",
        x: view.x,
        y: view.y,
        w: view.width,
        h: view.height,
        data: { opacityNormal: 1 },
        params: {},
        inputs: [],
        outputs: [],
    });
    selectionActions.set([view.sessionId]);
}

export function updateLiveCaptureUnitFrame(
    unitId: string,
    bytes: Uint8Array,
    mime: string,
    frameId: number,
    capturedAtMs = 0,
): void {
    const binding = bindings.get(unitId);
    if (!binding || capturedAtMs < (binding.snapshotAtMs ?? 0)) return;
    binding.frame = bytes;
    binding.mime = mime;
    binding.frameId = frameId;
    binding.frameCapturedAtMs = capturedAtMs;
    if (binding.committedFrameId === undefined) commitLiveCaptureUnitFrame(unitId);
}

export function commitLiveCaptureUnitFrame(unitId: string): void {
    const binding = bindings.get(unitId);
    const unit = graphStore.units.find((item) => item.id === unitId);
    if (!binding?.frame || !unit || (binding.committedFrameId === binding.frameId
        && binding.committedAtMs === binding.frameCapturedAtMs)) return;
    // Copy/save during an edit must use the visible edit snapshot, not a newer
    // background frame that the editor has never displayed.
    if (activeStickerEditTargetId() === unitId && binding.committedFrameId !== undefined) return;
    commitBytes(unitId, binding.frame, binding.mime ?? "image/jpeg");
    binding.committedFrameId = binding.frameId;
    binding.committedAtMs = binding.frameCapturedAtMs;
}

function commitBytes(unitId: string, bytes: Uint8Array, mime: string): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8_192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
    }
    const src = `data:${mime};base64,${btoa(binary)}`;
    graphStore.actions.updateUnitData(unitId, {
        src,
        previewSrc: undefined,
        filePath: undefined,
        dragOutFilePath: undefined,
    });
    return src;
}

// Ordinary Units and visible edit snapshots retain synchronous behavior. Callers
// await only a Live snapshot; concurrent consumers share one bounded native request.
export function prepareLiveCaptureUnitSnapshot(unitId: string): Promise<string | undefined> | undefined {
    const binding = bindings.get(unitId);
    if (!binding || activeStickerEditTargetId() === unitId) return undefined;
    if (binding.snapshot) return binding.snapshot;
    const readback = readLiveGpuSnapshot(unitId);
    binding.snapshot = readback.then((snapshot) => {
        if (bindings.get(unitId) !== binding || !graphStore.units.some((unit) => unit.id === unitId)) {
            throw new Error("Live Unit ended during snapshot");
        }
        // An editor opened while the readback was pending: never replace pixels
        // that the user is now editing with an unseen background frame.
        if (activeStickerEditTargetId() === unitId) return undefined;
        if (!snapshot || snapshot.capturedAtMs < (binding.frameCapturedAtMs ?? 0)) {
            commitLiveCaptureUnitFrame(unitId);
            return graphStore.units.find((unit) => unit.id === unitId)?.data.src;
        }
        binding.frame = snapshot.bytes;
        binding.mime = "image/png";
        binding.snapshotAtMs = snapshot.capturedAtMs;
        binding.frameCapturedAtMs = snapshot.capturedAtMs;
        binding.committedFrameId = binding.frameId;
        binding.committedAtMs = snapshot.capturedAtMs;
        return commitBytes(unitId, snapshot.bytes, "image/png");
    }).finally(() => { binding.snapshot = undefined; });
    return binding.snapshot;
}

export function sendLiveCaptureUnitInput(unitId: string, input: LiveCaptureInputPayload): Promise<void> {
    return bindings.get(unitId)?.sendInput(input) ?? Promise.resolve();
}

export function detachLiveCaptureUnit(unitId: string): void {
    if (!bindings.has(unitId)) return;
    commitLiveCaptureUnitFrame(unitId);
    bindings.delete(unitId);
    if (!graphStore.units.find((unit) => unit.id === unitId)?.data.src) {
        graphStore.actions.removeUnit(unitId);
        selectionActions.remove(unitId);
    }
}
