import type { LiveRelayFrameDescriptor, LiveRelaySnapshot } from "./liveRelay";

/** 单个最新样本，不保留像素、URL 或跨设备时钟推导的延迟。 */
export interface LiveRelayPresentation {
    liveSessionId: string;
    epoch: number;
    frameId: number;
    evidence: "decoded_submitted";
    payloadBytes: number;
    codec: LiveRelayFrameDescriptor["codec"];
    imageBytes: number;
    readMs: number;
    prepareMs: number;
    decodeMs: number;
    submittedAtMs: number;
}

export function validateRelayPresentationFrame(frame: LiveRelayFrameDescriptor, status: LiveRelaySnapshot): void {
    if (frame.relayId !== status.relayId || frame.liveSessionId !== status.liveSessionId
        || frame.epoch !== status.epoch || status.connectionState === "closed"
        || !Number.isSafeInteger(frame.frameId) || frame.frameId <= 0) {
        throw new Error("live_relay_frame_identity_mismatch");
    }
    if ((frame.codec !== "raw_bgra" && frame.codec !== "jpeg") || frame.colorSpace !== "srgb") {
        throw new Error("live_relay_presentation_profile_unsupported");
    }
    if (!Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height)
        || frame.width < 1 || frame.height < 1 || frame.width > 16_384 || frame.height > 16_384
        || frame.width * frame.height * 4 > 64 * 1024 * 1024
        || !Number.isSafeInteger(frame.byteLength) || frame.byteLength < 1
        || (frame.codec === "raw_bgra" && frame.byteLength !== frame.width * frame.height * 4)
        || (frame.codec === "jpeg" && frame.byteLength > 16 * 1024 * 1024)) {
        throw new Error("live_relay_frame_dimensions_invalid");
    }
}

/** 解码器只拥有候选帧；成功后 URL 所有权移交给 controller，失败或取消即释放。 */
export function decodeRelayImage(
    bytes: Uint8Array<ArrayBuffer>,
    frame: Pick<LiveRelayFrameDescriptor, "width" | "height" | "codec">,
    signal: AbortSignal,
): Promise<string> {
    if (signal.aborted) return Promise.reject(new Error("live_relay_decode_cancelled"));
    const image = new Image();
    const url = URL.createObjectURL(new Blob([bytes], { type: frame.codec === "jpeg" ? "image/jpeg" : "image/bmp" }));
    return new Promise<string>((resolve, reject) => {
        let settled = false;
        const finish = (error?: string) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            signal.removeEventListener("abort", cancel);
            if (error) {
                image.src = "";
                URL.revokeObjectURL(url);
                reject(new Error(error));
            } else {
                resolve(url);
            }
        };
        const cancel = () => finish("live_relay_decode_cancelled");
        const timer = window.setTimeout(() => finish("live_relay_decode_timeout"), 1000);
        signal.addEventListener("abort", cancel, { once: true });
        try {
            image.src = url;
            void image.decode().then(() => {
                finish(image.naturalWidth === frame.width && image.naturalHeight === frame.height
                    ? undefined : "live_relay_decode_dimensions_mismatch");
            }, () => finish("live_relay_decode_failed"));
        } catch {
            finish("live_relay_decode_failed");
        }
    });
}
