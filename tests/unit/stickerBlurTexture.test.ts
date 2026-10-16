// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireStickerBlurTexture } from "../../src/features/stickers/services/stickerBlurTexture";

vi.mock("../../src/platform/tauri/imageSource", () => ({ normalizeImageSourceForDisplay: (src: string) => src }));

class TestImage {
    static instances: TestImage[] = [];
    naturalWidth = 200;
    naturalHeight = 100;
    src = "";
    crossOrigin = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { TestImage.instances.push(this); }
}

describe("shared sticker blur raster lifetime", () => {
    const releases: Array<() => void> = [];
    const context = { filter: "none", scale: vi.fn(), drawImage: vi.fn() };
    let blobCallback: BlobCallback;
    let canvas: HTMLCanvasElement;
    const acquire = (source = "data:image/png;base64,test", w = 200, h = 200, radius = 8) => {
        const lease = acquireStickerBlurTexture(source, w, h, radius);
        releases.push(lease.release);
        return lease;
    };
    beforeEach(() => {
        TestImage.instances = [];
        context.filter = "none";
        vi.stubGlobal("Image", TestImage);
        vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:blur"), revokeObjectURL: vi.fn() });
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
            canvas = this;
            return context as unknown as CanvasRenderingContext2D;
        });
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => { blobCallback = callback; });
    });
    afterEach(async () => {
        releases.splice(0).forEach((release) => release());
        await Promise.resolve();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("rasterizes once with meet geometry and shares it until the last owner releases", async () => {
        const first = acquire();
        const second = acquire();
        expect(TestImage.instances).toHaveLength(1);
        TestImage.instances[0].onload!();
        expect(context.filter).toBe("blur(8px)");
        expect(context.drawImage).toHaveBeenCalledWith(TestImage.instances[0], 0, 50, 200, 100);
        blobCallback(new Blob(["blurred"]));
        expect(await first.ready).toBe("blob:blur");
        expect(await second.ready).toBe("blob:blur");
        expect(canvas.width).toBe(0);
        expect(canvas.height).toBe(0);
        first.release(); first.release();
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        second.release();
        await Promise.resolve();
        expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:blur");
    });

    it("cancels image loading and ignores a late blob after the last owner leaves", async () => {
        const lease = acquire();
        TestImage.instances[0].onload!();
        lease.release();
        expect(await lease.ready).toBeNull();
        expect(TestImage.instances[0].src).toBe("");
        expect(TestImage.instances[0].onload).toBeNull();
        blobCallback(new Blob(["late"]));
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(canvas.width).toBe(0);
    });

    it("does not cancel work while another overlay still retains it", async () => {
        const first = acquire();
        const second = acquire();
        first.release();
        TestImage.instances[0].onload!();
        blobCallback(new Blob());
        expect(await second.ready).toBe("blob:blur");
    });

    it("separates source, display size, and blur radius cache identities", () => {
        acquire(); acquire("data:second"); acquire(undefined, 100); acquire(undefined, 200, 200, 12);
        expect(TestImage.instances).toHaveLength(4);
    });

    it("requests CORS for asset images but not data/blob images", () => {
        acquire("http://asset.localhost/test.png"); acquire("blob:test");
        expect(TestImage.instances[0].crossOrigin).toBe("anonymous");
        expect(TestImage.instances[1].crossOrigin).toBe("");
    });

    it("falls back without an unhandled error when canvas readback is forbidden", async () => {
        vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(() => { throw new Error("SecurityError"); });
        const lease = acquire();
        TestImage.instances[0].onload!();
        expect(await lease.ready).toBeNull();
        expect(canvas.width).toBe(0);
    });

    it("bounds pending image lifetime and handles decode failure", async () => {
        vi.useFakeTimers();
        const timeout = acquire();
        const broken = acquire("data:broken");
        TestImage.instances[1].onerror!();
        expect(await broken.ready).toBeNull();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(await timeout.ready).toBeNull();
        expect(TestImage.instances.every((image) => image.onload === null)).toBe(true);
    });

    it("rejects invalid and oversized allocation requests", async () => {
        for (const [w, h, radius] of [[NaN, 20, 8], [0, 20, 8], [20, 20, Infinity], [8193, 20, 8], [5000, 5000, 8]]) {
            expect(await acquire(undefined, w, h, radius).ready).toBeNull();
        }
        expect(TestImage.instances).toHaveLength(0);
    });

    it("bounds shared pixels and returns capacity when owners release", async () => {
        const first = acquire("data:large1", 4096, 4096);
        acquire("data:large2", 4096, 4096);
        expect(await acquire("data:overflow").ready).toBeNull();
        first.release();
        await Promise.resolve();
        acquire("data:after-release");
        expect(TestImage.instances).toHaveLength(3);
    });

    it("hands a ready draft texture to the committed overlay without reloading or revoking it", async () => {
        const draft = acquire();
        TestImage.instances[0].onload!(); blobCallback(new Blob());
        await draft.ready;
        draft.release();
        const committed = acquire();
        expect(committed.url).toBe("blob:blur");
        await Promise.resolve();
        expect(TestImage.instances).toHaveLength(1);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        committed.release(); await Promise.resolve();
        expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:blur");
    });
});
