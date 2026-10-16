// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComputed, createRoot, createSignal } from "solid-js";
import { createStickerBrushFrameInput } from "../../src/features/stickers/components/stickerBrushFrameInput";

let frames: Map<number, FrameRequestCallback>;
let dispose: () => void;
const event = (x: number) => new PointerEvent("pointermove", { clientX: x });
const paint = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((cb) => cb(0)); };
beforeEach(() => {
    frames = new Map(); let id = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++id, cb); return id; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => { dispose?.(); vi.unstubAllGlobals(); });

const setup = () => createRoot((cleanup) => {
    dispose = cleanup;
    const [point, setPoint] = createSignal(0);
    let renders = 0, enabled = true;
    createComputed(() => { point(); renders++; });
    const move = vi.fn((e: PointerEvent) => setPoint(e.clientX));
    const up = vi.fn(async (e: PointerEvent) => { setPoint(e.clientX); enabled = false; });
    const cancel = vi.fn(async () => { enabled = false; });
    return { input: createStickerBrushFrameInput({ enabled: () => enabled, down: async () => {}, move, up, cancel }),
        point, move, up, renders: () => renders, disable: () => { enabled = false; } };
});

describe("frame bounded paintbrush input", () => {
    it("handles a 500 Hz burst in one render with bounded backlog and newest endpoint", () => {
        const state = setup();
        for (let i = 1; i <= 500; i++) state.input.move(event(i));
        expect(frames.size).toBe(1);
        expect(state.move).not.toHaveBeenCalled();
        paint();
        expect(state.point()).toBe(500);
        expect(state.move.mock.calls.length).toBeLessThanOrEqual(32);
        expect(state.renders()).toBe(2);
        expect(frames.size).toBe(0);
    });
    it("flushes before release without replaying old samples after commit", async () => {
        const state = setup();
        state.input.move(event(10)); state.input.move(event(20));
        await state.input.up(event(30));
        expect(state.point()).toBe(30);
        expect(state.up).toHaveBeenCalledOnce();
        expect(state.renders()).toBe(2);
        paint(); expect(state.point()).toBe(30);
    });
    it("drops pending work on cancellation, tool exit and disposal", async () => {
        const state = setup();
        state.input.move(event(10)); await state.input.cancel(); paint();
        expect(state.move).not.toHaveBeenCalled();
        dispose();
        const next = setup();
        next.input.move(event(20)); next.disable(); paint();
        expect(next.move).not.toHaveBeenCalled();
        dispose();
        const last = setup(); last.input.move(event(30)); dispose();
        expect(frames.size).toBe(0);
    });
});
