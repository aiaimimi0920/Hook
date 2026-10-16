// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { longCapturePreviewLayout } from "../../src/features/capture/services/longCapturePreviewLayout";

const mocks = vi.hoisted(() => ({ read: vi.fn(), move: vi.fn() }));
vi.mock("../../src/platform/tauri/api", () => ({ api: { previewLongCaptureSession: mocks.read, moveLongCaptureSession: mocks.move } }));
vi.mock("../../src/features/workspace/services/syncService", () => ({ syncService: { updateBackendRects: vi.fn(async () => undefined) } }));
vi.mock("../../src/features/workspace/state/uiStore", () => {
    const [session, setSession] = createSignal<unknown>(null);
    return { longCaptureSession: session, setLongCaptureSession: setSession };
});
import { longCaptureSession, setLongCaptureSession } from "../../src/features/workspace/state/uiStore";
import { longCaptureMoveDelta } from "../../src/features/capture/services/longCaptureMove";
import { LongCapturePreview } from "../../src/features/capture/components/LongCapturePreview";

const session = (id: string) => ({
    backendSessionId: id, active: true, status: "capturing" as const,
    rect: { x: 20, y: 30, w: 300, h: 400 }, frameCount: 1,
});
const picture = { revision: 1, width: 300, height: 1200, dataUrl: "data:image/png;base64,AA==" };
let dispose: (() => void) | undefined;
afterEach(() => {
    dispose?.(); dispose = undefined;
    setLongCaptureSession(null);
    document.body.replaceChildren();
    vi.useRealTimers(); vi.clearAllMocks();
});

describe("long capture preview", () => {
    it("moves along the capture axis with overlap and clamps to viewport edges", () => {
        const viewport = { width: 1000, height: 800 };
        const rect = { x: 20, y: 30, w: 300, h: 400 };
        expect(longCaptureMoveDelta(rect, false, -1, viewport)).toEqual({ dx: 0, dy: -30 });
        expect(longCaptureMoveDelta(rect, false, 1, viewport)).toEqual({ dx: 0, dy: 64 });
        expect(longCaptureMoveDelta(rect, true, 1, viewport)).toEqual({ dx: 60, dy: 0 });
        expect(longCaptureMoveDelta({ ...rect, y: 400 }, false, 1, viewport)).toEqual({ dx: 0, dy: 0 });
    });

    it("moves the viewfinder without resetting the session or aggregate preview", async () => {
        vi.useFakeTimers();
        mocks.read.mockResolvedValue(picture);
        mocks.move.mockResolvedValue({ x: 20, y: 94, w: 300, h: 400 });
        setLongCaptureSession({ ...session("first"), frameCount: 8 });
        dispose = render(() => <LongCapturePreview />, document.body);
        await vi.advanceTimersByTimeAsync(0);
        (document.querySelector('[aria-label="向下移动取景框"]') as HTMLButtonElement).click();
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.move).toHaveBeenCalledWith("first", 0, 64);
        expect(longCaptureSession()).toMatchObject({ backendSessionId: "first", frameCount: 8, rect: { y: 94 } });
        expect(document.querySelector("img")?.getAttribute("src")).toBe(picture.dataUrl);
        const right = document.querySelector('[aria-label="向右移动取景框"]') as HTMLButtonElement;
        expect(right.disabled).toBe(true);
        right.click();
        expect(mocks.move).toHaveBeenCalledTimes(1);
        mocks.read.mockResolvedValue({ ...picture, revision: 2 });
        await vi.advanceTimersByTimeAsync(500);
        expect(right.disabled).toBe(false);
        mocks.move.mockResolvedValue({ x: 80, y: 94, w: 300, h: 400 });
        right.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.move).toHaveBeenLastCalledWith("first", 60, 0);
        expect(longCaptureSession()).toMatchObject({ frameCount: 8, rect: { x: 80, y: 94 } });
        setLongCaptureSession({ ...session("first"), axis: "horizontal" });
        expect(document.querySelector('[aria-label="向左移动取景框"]')).not.toBeNull();
        expect(document.querySelector('[aria-label="向右移动取景框"]')).not.toBeNull();
    });

    it("prefers right, falls back left, clamps vertically and only overlaps excluded captures", () => {
        const viewport = { width: 1000, height: 800 };
        expect(longCapturePreviewLayout({ x: 100, y: 700, w: 400, h: 80 }, viewport))
            .toEqual({ x: 512, y: 148, width: 240, height: 640 });
        expect(longCapturePreviewLayout({ x: 600, y: 20, w: 380, h: 400 }, viewport)?.x).toBe(348);
        const fullscreen = { x: 0, y: 0, w: 1000, h: 800 };
        expect(longCapturePreviewLayout(fullscreen, viewport)).toBeNull();
        expect(longCapturePreviewLayout(fullscreen, viewport, true)?.x).toBe(748);
    });

    it("renders aggregate dimensions, serially polls revisions, and ignores unrelated session updates", async () => {
        vi.useFakeTimers();
        mocks.read.mockResolvedValueOnce(picture).mockResolvedValue(null);
        setLongCaptureSession(session("first"));
        dispose = render(() => <LongCapturePreview />, document.body);
        await vi.advanceTimersByTimeAsync(0);
        expect(document.body.textContent).toContain("300 × 1200");
        expect(document.querySelector("img")?.getAttribute("src")).toBe(picture.dataUrl);
        setLongCaptureSession({ ...session("first"), frameCount: 5 });
        await vi.advanceTimersByTimeAsync(500);
        expect(mocks.read.mock.calls).toEqual([["first", undefined], ["first", 1]]);
        expect(document.querySelector("img")).not.toBeNull();
        dispose(); dispose = undefined;
        await vi.advanceTimersByTimeAsync(1000);
        expect(mocks.read).toHaveBeenCalledTimes(2);
    });

    it("rejects late responses after restart and never stacks polls", async () => {
        vi.useFakeTimers();
        let resolve!: (value: typeof picture) => void;
        mocks.read.mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
            .mockResolvedValue(null);
        setLongCaptureSession(session("old"));
        dispose = render(() => <LongCapturePreview />, document.body);
        await vi.advanceTimersByTimeAsync(2000);
        expect(mocks.read).toHaveBeenCalledTimes(1);
        setLongCaptureSession(session("new"));
        resolve(picture);
        await vi.advanceTimersByTimeAsync(0);
        expect(document.querySelector("img")).toBeNull();
        expect(mocks.read.mock.calls[1]).toEqual(["new", undefined]);
    });
});
