import type { StickerPoint } from "../types/stickerEditing";

/**
 * Shared plumbing for the live (drag-to-erase) pipelines.
 *
 * Both the "erase annotations only" and "erase image content" flows need the
 * same concurrency machinery: a monotonic generation token so a new stroke
 * supersedes an in-flight one, a pending-points buffer that coalesces pointer
 * moves arriving faster than the async erase can process them, a single-runner
 * guard, and a promise the pointer-up handler can await. This class owns exactly
 * that plumbing so the two call sites no longer duplicate (and drift on) the
 * tricky race handling; the layer-specific erase + patch work stays in a
 * `process` callback supplied by the caller.
 *
 * The callback receives the generation it was started under and should re-check
 * `isCurrent(generation)` after every `await` before applying a result, exactly
 * as the inline queues did, so results from a superseded/finished stroke are
 * dropped instead of clobbering newer state.
 */
export type LiveEraseBatchProcessor = (
    points: StickerPoint[],
    generation: number,
) => Promise<void>;

export interface LiveEraseQueueMetrics {
    queuedPoints: number;
    processedPoints: number;
    processedBatches: number;
    coalescedPoints: number;
    maxPendingPoints: number;
    currentPendingPoints: number;
    activeRunners: number;
    maxConcurrentRunners: number;
    errors: number;
}

export const DEFAULT_LIVE_ERASE_MAX_PENDING_POINTS = 512;

const compactPoints = (points: StickerPoint[], limit: number): StickerPoint[] => {
    if (points.length <= limit) return points;
    if (limit === 1) return [points[points.length - 1]];

    const compacted: StickerPoint[] = [];
    const lastIndex = points.length - 1;
    for (let index = 0; index < limit; index += 1) {
        compacted.push(points[Math.round((lastIndex * index) / (limit - 1))]);
    }
    return compacted;
};

export class LiveEraseQueue {
    private active = false;
    private generation = 0;
    private running = false;
    private pending: StickerPoint[] = [];
    private promise: Promise<void> = Promise.resolve();
    private activeRunners = 0;
    private readonly metrics: Omit<LiveEraseQueueMetrics, "currentPendingPoints" | "activeRunners"> = {
        queuedPoints: 0,
        processedPoints: 0,
        processedBatches: 0,
        coalescedPoints: 0,
        maxPendingPoints: 0,
        maxConcurrentRunners: 0,
        errors: 0,
    };

    constructor(
        private readonly maxPendingPoints = DEFAULT_LIVE_ERASE_MAX_PENDING_POINTS,
    ) {
        if (!Number.isInteger(maxPendingPoints) || maxPendingPoints < 1) {
            throw new Error("Live erase max pending points must be a positive integer");
        }
    }

    /** Whether a stroke is currently in progress. */
    get isActive(): boolean {
        return this.active;
    }

    /** The generation of the current stroke (increments on every `begin`). */
    get currentGeneration(): number {
        return this.generation;
    }

    getMetrics(): LiveEraseQueueMetrics {
        return {
            ...this.metrics,
            currentPendingPoints: this.pending.length,
            activeRunners: this.activeRunners,
        };
    }

    /**
     * True while `generation` is still the live run: not superseded by a newer
     * `begin`, and not yet deactivated by `finish`. Callers use this to drop
     * stale async results after each `await`.
     */
    isCurrent(generation: number): boolean {
        return generation === this.generation && this.active;
    }

    /**
     * Start a new stroke, superseding any in-flight one. Returns the new
     * generation token. Resets the pending buffer and runner state so a fresh
     * `process` loop starts on the next `apply`.
     */
    begin(): number {
        this.generation += 1;
        this.active = true;
        this.pending = [];
        this.running = false;
        this.promise = Promise.resolve();
        return this.generation;
    }

    /**
     * Queue `points` for processing. Points arriving while the runner is busy are
     * buffered and drained in the same loop. Returns the promise for the current
     * run so callers can await it (e.g. from `finish`). No-ops when inactive or
     * given an empty batch.
     */
    apply(points: StickerPoint[], process: LiveEraseBatchProcessor): Promise<void> {
        if (!this.active || points.length < 1) {
            return this.promise;
        }
        this.metrics.queuedPoints += points.length;
        const combined = [...this.pending, ...points];
        this.pending = compactPoints(combined, this.maxPendingPoints);
        this.metrics.coalescedPoints += combined.length - this.pending.length;
        this.metrics.maxPendingPoints = Math.max(
            this.metrics.maxPendingPoints,
            this.pending.length,
        );
        if (!this.running) {
            this.promise = this.drain(this.generation, process);
        }
        return this.promise;
    }

    private async drain(generation: number, process: LiveEraseBatchProcessor): Promise<void> {
        this.running = true;
        this.activeRunners += 1;
        this.metrics.maxConcurrentRunners = Math.max(
            this.metrics.maxConcurrentRunners,
            this.activeRunners,
        );
        try {
            while (this.isCurrent(generation) && this.pending.length > 0) {
                const points = this.pending;
                this.pending = [];
                this.metrics.processedBatches += 1;
                this.metrics.processedPoints += points.length;
                await process(points, generation);
            }
        } catch (error) {
            this.metrics.errors += 1;
            console.error("[Hook] Live erase queue failed", error);
        } finally {
            this.activeRunners -= 1;
            // Only clear the runner flag if we are still the current generation;
            // a superseding begin() already reset it for the new run.
            if (generation === this.generation) {
                this.running = false;
            }
        }
    }

    /**
     * Await the in-flight run and deactivate this stroke. Returns true if this
     * stroke is still the current one (so the caller should commit its result),
     * or false if it was never active or has been superseded by a newer stroke
     * (in which case the newer stroke owns the state and the caller must not
     * commit).
     */
    async finish(): Promise<boolean> {
        if (!this.active) return false;
        const generation = this.generation;
        await this.promise;
        if (generation !== this.generation) return false;
        this.active = false;
        this.pending = [];
        this.running = false;
        return true;
    }
}
