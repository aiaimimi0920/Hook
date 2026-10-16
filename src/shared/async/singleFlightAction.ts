export interface SingleFlightAction {
    isPending: () => boolean;
    run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
    dispose: () => void;
}

/** Prevents overlapping async mutations and suppresses lifecycle callbacks after disposal. */
export const createSingleFlightAction = (
    onPendingChange: (pending: boolean) => void = () => undefined,
): SingleFlightAction => {
    let pending = false;
    let disposed = false;

    const notifyPendingChange = () => {
        if (!disposed) onPendingChange(pending);
    };

    return {
        isPending: () => pending,
        run: async <T>(action: () => Promise<T>) => {
            if (disposed || pending) return undefined;

            pending = true;
            notifyPendingChange();
            try {
                return await action();
            } finally {
                pending = false;
                notifyPendingChange();
            }
        },
        dispose: () => {
            disposed = true;
        },
    };
};
