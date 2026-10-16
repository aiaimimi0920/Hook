type RequestState =
    | { status: "requested" | "attached" }
    | { status: "failed"; retryAfter: number };

const states = new Map<string, RequestState>();
const RETRY_DELAY_MS = 3_000;

export const surfaceAttachmentRequests = {
    begin(unitId: string): boolean {
        const current = states.get(unitId);
        if (current?.status === "requested" || current?.status === "attached") return false;
        if (current?.status === "failed" && Date.now() < current.retryAfter) return false;
        states.set(unitId, { status: "requested" });
        return true;
    },

    complete(unitId: string): void {
        states.set(unitId, { status: "attached" });
    },

    fail(unitId: string): void {
        states.set(unitId, { status: "failed", retryAfter: Date.now() + RETRY_DELAY_MS });
    },

    clear(unitId: string): void {
        states.delete(unitId);
    },

    clearAll(): void {
        states.clear();
    },
};
