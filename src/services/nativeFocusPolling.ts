interface NativeFocusPollingDependencies {
    hasForegroundWindow: () => Promise<boolean>;
    notifyFocusChanged: (focused: boolean) => void;
    intervalMs?: number;
}

/** Polls native focus without overlapping calls or notifying after disposal. */
export const installNativeFocusPolling = ({
    hasForegroundWindow,
    notifyFocusChanged,
    intervalMs = 250,
}: NativeFocusPollingDependencies) => {
    let disposed = false;
    let pollInFlight = false;
    let lastFocus: boolean | undefined;

    const poll = async () => {
        if (disposed || pollInFlight) return;
        pollInFlight = true;
        try {
            const focused = await hasForegroundWindow();
            if (!disposed && focused !== lastFocus) {
                lastFocus = focused;
                notifyFocusChanged(focused);
            }
        } catch {
            // A transient native transport failure is retried on the next tick.
        } finally {
            pollInFlight = false;
        }
    };

    const timer = window.setInterval(() => void poll(), intervalMs);
    void poll();
    return () => {
        disposed = true;
        window.clearInterval(timer);
    };
};
