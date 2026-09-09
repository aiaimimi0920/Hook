import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeLiveFrame, liveFrameDelay, LIVE_CAPTURE_TARGET_FPS } from "../../src/services/liveCapturePresentation";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => {
    vi.stubGlobal("URL", class extends URL {
        static createObjectURL = vi.fn(() => "blob:test");
        static revokeObjectURL = vi.fn();
    });
});

describe("Live video presentation", () => {
    it("targets 60 FPS and subtracts work instead of accumulating transport/decode latency", () => {
        expect(LIVE_CAPTURE_TARGET_FPS).toBe(60);
        expect(liveFrameDelay(60, 10)).toBeCloseTo(6.667, 2);
        expect(liveFrameDelay(60, 30)).toBe(1);
        expect(liveFrameDelay(12, 10)).toBeCloseTo(73.333, 2);
        expect(liveFrameDelay(1000)).toBeCloseTo(16.667, 2);
    });

    it("does not publish a URL until decoding finishes and passes the original binary view to Blob", async () => {
        let finish!: () => void;
        const decode = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
        vi.stubGlobal("Image", class { src = ""; decode = decode; });
        const bytes = new Uint8Array([1, 2, 3]);
        let parts: BlobPart[] = [];
        vi.stubGlobal("Blob", class { constructor(input: BlobPart[]) { parts = input; } });
        const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:decoded");
        let published = false;
        const ready = decodeLiveFrame(bytes, "image/jpeg").then((url) => { published = true; return url; });
        await Promise.resolve();
        expect(published).toBe(false);
        expect(parts[0]).toBe(bytes);
        finish();
        await expect(ready).resolves.toBe("blob:decoded");
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("revokes an undecodable frame without handing it to the display", async () => {
        vi.stubGlobal("Image", class { src = ""; decode = () => Promise.reject(new Error("bad frame")); });
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:bad");
        const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
        await expect(decodeLiveFrame(new Uint8Array([0]), "image/jpeg")).rejects.toThrow("bad frame");
        expect(revoke).toHaveBeenCalledWith("blob:bad");
    });
});
