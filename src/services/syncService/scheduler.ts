//! Debounces sync work and owns every retry timer so callers can cancel cleanly.

export class SyncScheduler {
    private debounceTimer: number | null = null;
    private retryTimer: number | null = null;
    private isSyncing = false;
    private retryCount = 0;
    private hasPendingSync = false;
    private disposed = false;
    private readonly MAX_RETRIES = 5;
    private readonly DEBOUNCE_MS = 50;

    constructor(private readonly doSync: () => Promise<void>) {}

    public schedule(): void {
        if (this.disposed) return;
        this.clearDebounceTimer();
        this.clearRetryTimer();
        this.hasPendingSync = true;
        this.debounceTimer = window.setTimeout(() => {
            this.debounceTimer = null;
            void this.trigger();
        }, this.DEBOUNCE_MS);
    }

    public dispose(): void {
        this.disposed = true;
        this.hasPendingSync = false;
        this.clearDebounceTimer();
        this.clearRetryTimer();
    }

    private clearDebounceTimer(): void {
        if (this.debounceTimer !== null) {
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    private clearRetryTimer(): void {
        if (this.retryTimer !== null) {
            window.clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }

    private async trigger(): Promise<void> {
        if (this.disposed || this.isSyncing) return;

        this.isSyncing = true;
        this.hasPendingSync = false;
        try {
            await this.doSync();
            this.retryCount = 0;
        } catch (error) {
            console.error("Sync cycle failed", error);
            if (!this.disposed && this.retryCount < this.MAX_RETRIES) {
                this.retryCount += 1;
                const delay = Math.min(1000 * 2 ** this.retryCount, 10_000);
                console.log(
                    `Retrying sync in ${delay}ms (Attempt ${this.retryCount}/${this.MAX_RETRIES})`,
                );
                this.retryTimer = window.setTimeout(() => {
                    this.retryTimer = null;
                    this.hasPendingSync = true;
                    void this.trigger();
                }, delay);
            } else if (!this.disposed) {
                console.error("Max sync retries reached. Giving up until next trigger.");
            }
        } finally {
            this.isSyncing = false;
            if (this.hasPendingSync && !this.disposed) {
                // Changes that arrive during a sync re-enter through the debounce
                // window instead of spinning save/sync cycles back-to-back.
                this.schedule();
            }
        }
    }
}
