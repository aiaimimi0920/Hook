export type AppDisposer = () => void;

type AppListenerRegistryOptions = {
    onCleanupError?: (error: unknown) => void;
};

const noopDisposer: AppDisposer = () => undefined;

/**
 * Owns listener disposers as soon as each asynchronous registration completes.
 * Disposal is idempotent, reverse ordered, and also covers registrations that
 * resolve after their component has already unmounted.
 */
export class AppListenerRegistry {
    private static activeDisposerCount = 0;
    private readonly disposers: AppDisposer[] = [];
    private readonly knownDisposers = new Set<AppDisposer>();
    private readonly onCleanupError: (error: unknown) => void;
    private disposed = false;

    constructor(options: AppListenerRegistryOptions = {}) {
        this.onCleanupError = options.onCleanupError ?? ((error) => {
            console.error("Failed to dispose an application listener", error);
        });
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    static diagnostics(): { activeDisposers: number } {
        return { activeDisposers: AppListenerRegistry.activeDisposerCount };
    }

    push(...disposers: AppDisposer[]): number {
        for (const disposer of disposers) {
            if (this.knownDisposers.has(disposer)) continue;
            this.knownDisposers.add(disposer);
            if (this.disposed) {
                this.runDisposer(disposer);
            } else {
                this.disposers.push(disposer);
                AppListenerRegistry.activeDisposerCount += 1;
            }
        }
        return this.disposers.length;
    }

    async register(setup: () => Promise<AppDisposer>): Promise<AppDisposer> {
        if (this.disposed) return noopDisposer;

        let disposer: AppDisposer;
        try {
            disposer = await setup();
        } catch (error) {
            this.dispose();
            throw error;
        }

        this.push(disposer);
        return disposer;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        for (let index = this.disposers.length - 1; index >= 0; index -= 1) {
            this.runDisposer(this.disposers[index]);
            AppListenerRegistry.activeDisposerCount = Math.max(0, AppListenerRegistry.activeDisposerCount - 1);
        }
        this.disposers.length = 0;
    }

    private runDisposer(disposer: AppDisposer): void {
        try {
            disposer();
        } catch (error) {
            try {
                this.onCleanupError(error);
            } catch {
                // Cleanup error reporting must not prevent remaining disposers.
            }
        }
    }
}
