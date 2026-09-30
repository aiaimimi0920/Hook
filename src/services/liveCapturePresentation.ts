/** Local video pacing never adds IPC/decode time on top of a complete frame interval. */
export const LIVE_CAPTURE_TARGET_FPS = 60;

export function liveFrameDelay(targetFps: number, elapsedMs = 0): number {
    const fps = Math.min(LIVE_CAPTURE_TARGET_FPS, Math.max(1, targetFps));
    return Math.max(1, 1_000 / fps - Math.max(0, elapsedMs));
}

/** Keep displaying the previous frame until the next JPEG is decoded, not merely downloaded. */
export async function decodeLiveFrame(bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<string> {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return url;
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
}
