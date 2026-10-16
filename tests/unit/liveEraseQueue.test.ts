import { describe, expect, it, vi } from "vitest";

import { LiveEraseQueue } from "../../src/features/live/services/liveEraseQueue";
import type { StickerPoint } from "../../src/features/stickers/types/stickerEditing";

const pt = (x: number, y: number): StickerPoint => ({ x, y });

// A deferred promise helper so tests can control exactly when an in-flight
// process() call resolves, letting us interleave begin()/apply()/finish().
const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

describe("LiveEraseQueue", () => {
    it("starts inactive and becomes active only after begin()", () => {
        const queue = new LiveEraseQueue();
        expect(queue.isActive).toBe(false);
        queue.begin();
        expect(queue.isActive).toBe(true);
    });

    it("increments the generation on every begin()", () => {
        const queue = new LiveEraseQueue();
        const first = queue.begin();
        const second = queue.begin();
        expect(second).toBe(first + 1);
        expect(queue.currentGeneration).toBe(second);
    });

    it("no-ops apply() when inactive or given an empty batch", async () => {
        const queue = new LiveEraseQueue();
        const process = vi.fn(async () => {});

        await queue.apply([pt(1, 1)], process);
        expect(process).not.toHaveBeenCalled(); // inactive

        queue.begin();
        await queue.apply([], process);
        expect(process).not.toHaveBeenCalled(); // empty batch
    });

    it("processes queued points and passes the current generation", async () => {
        const queue = new LiveEraseQueue();
        const seen: Array<{ points: StickerPoint[]; generation: number }> = [];
        const process = vi.fn(async (points: StickerPoint[], generation: number) => {
            seen.push({ points, generation });
        });

        const generation = queue.begin();
        await queue.apply([pt(1, 1), pt(2, 2)], process);

        expect(seen).toHaveLength(1);
        expect(seen[0].points).toEqual([pt(1, 1), pt(2, 2)]);
        expect(seen[0].generation).toBe(generation);
    });

    it("coalesces points that arrive while a batch is still processing", async () => {
        const queue = new LiveEraseQueue();
        const gate = deferred();
        const batches: StickerPoint[][] = [];
        let call = 0;
        const process = vi.fn(async (points: StickerPoint[]) => {
            batches.push(points);
            call += 1;
            if (call === 1) {
                // Hold the first batch open so the second apply() only buffers.
                await gate.promise;
            }
        });

        queue.begin();
        const first = queue.apply([pt(1, 1)], process);
        // Arrives while the first batch is still awaiting the gate: must buffer,
        // not spawn a second concurrent runner.
        queue.apply([pt(2, 2)], process);
        expect(process).toHaveBeenCalledTimes(1);

        gate.resolve();
        await first;

        // The buffered point is drained in the same runner as a second batch.
        expect(batches).toEqual([[pt(1, 1)], [pt(2, 2)]]);
    });

    it("drops stale results when a newer begin() supersedes the run", async () => {
        const queue = new LiveEraseQueue();
        const gate = deferred();
        const processedGenerations: number[] = [];
        const process = vi.fn(async (_points: StickerPoint[], generation: number) => {
            await gate.promise;
            // Only record if still current, mirroring the real callback's guard.
            if (queue.isCurrent(generation)) {
                processedGenerations.push(generation);
            }
        });

        const firstGen = queue.begin();
        const firstRun = queue.apply([pt(1, 1)], process);

        // Supersede mid-flight.
        const secondGen = queue.begin();
        gate.resolve();
        await firstRun;

        expect(queue.isCurrent(firstGen)).toBe(false);
        expect(queue.isCurrent(secondGen)).toBe(true);
        // The first run's result was dropped because its generation was stale.
        expect(processedGenerations).not.toContain(firstGen);
    });

    it("finish() returns true for the current stroke and deactivates it", async () => {
        const queue = new LiveEraseQueue();
        const process = vi.fn(async () => {});
        queue.begin();
        await queue.apply([pt(1, 1)], process);

        const committed = await queue.finish();
        expect(committed).toBe(true);
        expect(queue.isActive).toBe(false);
    });

    it("finish() returns false when never active", async () => {
        const queue = new LiveEraseQueue();
        expect(await queue.finish()).toBe(false);
    });

    it("finish() returns false when the stroke was superseded before finishing", async () => {
        const queue = new LiveEraseQueue();
        const gate = deferred();
        const process = vi.fn(async () => {
            await gate.promise;
        });

        queue.begin();
        queue.apply([pt(1, 1)], process);
        const finishPromise = queue.finish();

        // A new stroke starts before the awaited run settles.
        queue.begin();
        gate.resolve();

        expect(await finishPromise).toBe(false);
    });

    it("keeps running after a process() error without wedging the queue", async () => {
        const queue = new LiveEraseQueue();
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        let call = 0;
        const process = vi.fn(async () => {
            call += 1;
            if (call === 1) throw new Error("boom");
        });

        queue.begin();
        await queue.apply([pt(1, 1)], process);

        // A subsequent stroke still processes normally.
        queue.begin();
        await queue.apply([pt(2, 2)], process);
        expect(process).toHaveBeenCalledTimes(2);

        errorSpy.mockRestore();
    });
});
