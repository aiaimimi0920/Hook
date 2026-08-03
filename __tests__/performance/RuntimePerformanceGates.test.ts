import { describe, expect, it } from "vitest";

import { buildDragTargetIndex } from "../../src/services/dragTargetIndex";
import {
    DEFAULT_LIVE_ERASE_MAX_PENDING_POINTS,
    LiveEraseQueue,
} from "../../src/services/liveEraseQueue";
import type { Unit } from "../../src/types/unit";
import type { StickerPoint } from "../../src/types/stickerEditing";

const units = (count: number): Unit[] =>
    Array.from({ length: count }, (_, index) => ({
        id: `perf-${index}`,
        type: "sticker",
        x: (index % 50) * 180,
        y: Math.floor(index / 50) * 140,
        w: 160,
        h: 120,
        data: {},
        params: {},
        inputs: [],
        outputs: [],
    }));

const percentile = (values: number[], fraction: number) => {
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] ?? 0;
};

describe("runtime performance gates", () => {
    it("keeps large-canvas drag frame work inside a deterministic CPU budget", () => {
        const targets = units(2_000);
        const buildStartedAt = performance.now();
        const index = buildDragTargetIndex(targets, new Set());
        const buildMs = performance.now() - buildStartedAt;
        const frameSamples: number[] = [];

        for (let frame = 0; frame < 240; frame += 1) {
            const startedAt = performance.now();
            for (let query = 0; query < 40; query += 1) {
                const x = ((frame * 31) + query * 97) % 9_000;
                const y = ((frame * 17) + query * 53) % 5_600;
                index.findCascadeTarget(x, y);
                index.findAlignmentTargets(x, y, 160, 120, 15);
            }
            frameSamples.push(performance.now() - startedAt);
        }

        expect(buildMs).toBeLessThan(1_000);
        expect(percentile(frameSamples, 0.95)).toBeLessThan(25);
        expect(Math.max(...frameSamples)).toBeLessThan(75);
    });

    it("bounds live erase queue depth while preserving the newest path", async () => {
        const queue = new LiveEraseQueue();
        let releaseFirstBatch!: () => void;
        const firstBatchGate = new Promise<void>((resolve) => {
            releaseFirstBatch = resolve;
        });
        let batches = 0;
        const process = async () => {
            batches += 1;
            if (batches === 1) await firstBatchGate;
        };

        queue.begin();
        const run = queue.apply([{ x: 0, y: 0 }], process);
        for (let batch = 0; batch < 200; batch += 1) {
            const points: StickerPoint[] = Array.from({ length: 100 }, (_, index) => ({
                x: batch * 100 + index,
                y: batch,
            }));
            queue.apply(points, process);
        }

        const blockedMetrics = queue.getMetrics();
        expect(blockedMetrics.maxPendingPoints).toBeLessThanOrEqual(
            DEFAULT_LIVE_ERASE_MAX_PENDING_POINTS,
        );
        expect(blockedMetrics.coalescedPoints).toBeGreaterThan(0);

        releaseFirstBatch();
        await run;
        const drainedMetrics = queue.getMetrics();
        expect(drainedMetrics.currentPendingPoints).toBe(0);
        expect(drainedMetrics.errors).toBe(0);
        expect(drainedMetrics.maxConcurrentRunners).toBe(1);
    });

    it("completes a bounded erase soak without queue or heap growth", async () => {
        const queue = new LiveEraseQueue();
        const heapBefore = process.memoryUsage().heapUsed;
        const startedAt = performance.now();

        for (let stroke = 0; stroke < 500; stroke += 1) {
            queue.begin();
            const points = Array.from({ length: 32 }, (_, index) => ({
                x: index,
                y: stroke,
            }));
            await queue.apply(points, async () => {});
            expect(await queue.finish()).toBe(true);
        }

        const elapsedMs = performance.now() - startedAt;
        const heapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
        const metrics = queue.getMetrics();

        expect(elapsedMs).toBeLessThan(5_000);
        expect(heapGrowthBytes).toBeLessThan(256 * 1024 * 1024);
        expect(metrics.currentPendingPoints).toBe(0);
        expect(metrics.maxPendingPoints).toBeLessThanOrEqual(32);
        expect(metrics.errors).toBe(0);
        expect(metrics.activeRunners).toBe(0);
    });
});
