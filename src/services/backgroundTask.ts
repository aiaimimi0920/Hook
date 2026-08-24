/** Observes detached UI work without copying potentially sensitive error details into logs. */
export const runBackgroundTask = (operation: string, promise: Promise<unknown>): void => {
    void promise.catch((error: unknown) => {
        const category = error instanceof Error ? error.name : "NonErrorRejection";
        console.error(`[Hook] ${operation} failed (${category})`);
    });
};
