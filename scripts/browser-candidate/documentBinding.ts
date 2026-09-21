// Candidate provider logic only; not an installed or authorized Hook adapter.
export type BrowserCommand = "Page.enable" | "Page.getFrameTree" | "Page.captureScreenshot";
export type BrowserEvent = "Page.frameNavigated" | "Page.frameStartedLoading" | "Inspector.detached" | "close";
export interface BrowserTransport {
    request(method: BrowserCommand, params?: Record<string, unknown>): Promise<unknown>;
    subscribe(event: BrowserEvent, listener: (payload: unknown) => void): () => void;
    detach(): Promise<void>;
}
export interface DocumentRegion { x: number; y: number; width: number; height: number }

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") throw new Error("BROWSER_INVALID_RESPONSE");
    return value as Record<string, unknown>;
}

function identity(reply: unknown) {
    const frame = record(record(record(reply).frameTree).frame);
    if (typeof frame.id !== "string" || !frame.id || typeof frame.loaderId !== "string" || !frame.loaderId) {
        throw new Error("BROWSER_DOCUMENT_UNAVAILABLE");
    }
    return { frameId: frame.id, loaderId: frame.loaderId };
}

function validateRegion(region: DocumentRegion): DocumentRegion {
    const { x, y, width, height } = region;
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 ||
        width <= 0 || height <= 0 || width > 8192 || height > 8192 ||
        width * height > 4_194_304 || x + width > 1_000_000 || y + height > 1_000_000) {
        throw new Error("BROWSER_INVALID_REGION");
    }
    return { x, y, width, height };
}

// One dedicated target session owns all its regions. Busy calls are rejected,
// never queued; a provider scheduler must retry fairly and apply its rate budget.
export async function createDocumentBinding(transport: BrowserTransport, timeoutMs = 5000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
        throw new Error("BROWSER_INVALID_TIMEOUT");
    }
    let source: ReturnType<typeof identity> | undefined;
    let failure: string | undefined;
    let busy = false;
    const unsubscribe: Array<() => void> = [];
    const cancellations = new Set<() => void>();
    let detached: Promise<void> | undefined;
    function close(reason = "BROWSER_BINDING_REVOKED") {
        if (!failure) {
            failure = reason;
            for (const cancel of cancellations) cancel();
            cancellations.clear();
            for (const remove of unsubscribe.splice(0)) remove();
            detached = Promise.resolve().then(() => transport.detach()).catch(() => undefined);
        }
        return detached!;
    }
    function assertOpen() { if (failure) throw new Error(failure); }
    async function request(method: BrowserCommand, params?: Record<string, unknown>) {
        assertOpen();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancel: (() => void) | undefined;
        try {
            const reply = await Promise.race([
                Promise.resolve().then(() => { assertOpen(); return transport.request(method, params); }),
                new Promise<never>((_, reject) => {
                    cancel = () => reject(new Error(failure));
                    cancellations.add(cancel);
                }),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        void close("BROWSER_CAPTURE_TIMEOUT");
                        reject(new Error("BROWSER_CAPTURE_TIMEOUT"));
                    }, timeoutMs);
                }),
            ]);
            assertOpen();
            return reply;
        } finally {
            if (timer !== undefined) clearTimeout(timer);
            if (cancel) cancellations.delete(cancel);
        }
    }
    function on(event: BrowserEvent, listener: (payload: unknown) => void) {
        unsubscribe.push(transport.subscribe(event, (payload) => {
            try { listener(payload); }
            catch { void close("BROWSER_INVALID_EVENT"); }
        }));
    }
    try {
        on("Page.frameNavigated", (payload) => {
            const frame = record(record(payload).frame);
            if (!frame.parentId) void close("BROWSER_DOCUMENT_CHANGED");
        });
        on("Page.frameStartedLoading", (payload) => {
            if (source && record(payload).frameId === source.frameId) void close("BROWSER_DOCUMENT_CHANGED");
        });
        on("Inspector.detached", () => { void close("BROWSER_SOURCE_CLOSED"); });
        on("close", () => { void close("BROWSER_SOURCE_CLOSED"); });
        await request("Page.enable");
        source = identity(await request("Page.getFrameTree"));
        assertOpen();
    } catch (error) {
        await close("BROWSER_BINDING_FAILED");
        throw error;
    }
    async function assertDocument() {
        const current = identity(await request("Page.getFrameTree"));
        if (current.frameId !== source!.frameId || current.loaderId !== source!.loaderId) {
            void close("BROWSER_DOCUMENT_CHANGED");
            assertOpen();
        }
    }
    return {
        close,
        bind(region: DocumentRegion) {
            assertOpen();
            const clip = Object.freeze({ ...validateRegion(region), scale: 1 });
            return async () => {
                assertOpen();
                if (busy) throw new Error("BROWSER_CAPTURE_BUSY");
                busy = true;
                try {
                    await assertDocument();
                    const reply = record(await request("Page.captureScreenshot", {
                        format: "png", fromSurface: true, captureBeyondViewport: true, clip,
                    }));
                    // Navigation may occur while capture is in flight. Never publish
                    // replacement-document pixels under the original binding.
                    await assertDocument();
                    if (typeof reply.data !== "string" || !reply.data.length || reply.data.length > 24_000_000) {
                        throw new Error("BROWSER_INVALID_FRAME");
                    }
                    return reply.data;
                } catch (error) {
                    void close("BROWSER_CAPTURE_FAILED");
                    throw error;
                } finally { busy = false; }
            };
        },
    };
}
