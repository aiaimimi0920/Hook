import { invoke } from "@tauri-apps/api/core";

/** Only the protocol-facing subset is exposed; no browser URL or credential access. */
export interface ExtensionTransport {
    readonly readyState: number;
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    send(text: string): void;
    close(): void;
}

type PollResult = { epoch: string; connected: boolean; closed: boolean; message: string | null };
type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const MAX_BYTES = 64 * 1024 * 1024;

/** One leased native session, one poll and one send in flight; stale epochs never dispatch. */
export class ExtensionNativeTransport implements ExtensionTransport {
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    private epoch: string | null = null;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly outgoing: { text: string; bytes: number }[] = [];
    private queuedBytes = 0;
    private sending = false;

    constructor(private readonly nativeInvoke: NativeInvoke = invoke) {
        // Allow the protocol owner to install handlers before native open can complete.
        queueMicrotask(() => { void this.open(); });
    }

    send(text: string): void {
        if (this.readyState !== 1) throw new Error("Extension bridge disconnected");
        if (text.length > MAX_BYTES) throw new Error("Extension bridge message limit reached");
        const bytes = new TextEncoder().encode(text).byteLength;
        if (this.outgoing.length >= 128 || bytes > MAX_BYTES - this.queuedBytes) {
            throw new Error("Extension bridge queue limit reached");
        }
        this.outgoing.push({ text, bytes });
        this.queuedBytes += bytes;
        void this.drain();
    }

    close(): void {
        if (this.readyState === 3) return;
        this.readyState = 3;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
        this.outgoing.length = 0;
        this.queuedBytes = 0;
        const epoch = this.epoch;
        this.epoch = null;
        if (epoch) void this.release(epoch);
        this.onclose?.();
    }

    private async release(epoch: string): Promise<void> {
        try { await this.nativeInvoke("extension_bridge_close", { epoch }); }
        catch { /* Native lease expiry and process shutdown remain cleanup owners. */ }
    }

    private async open(): Promise<void> {
        if (this.readyState === 3) return;
        try {
            const epoch = await this.nativeInvoke<string>("extension_bridge_open");
            if (this.closed()) { await this.release(epoch); return; }
            this.epoch = epoch;
            await this.poll(epoch);
        } catch { this.fail(); }
    }

    private closed(): boolean { return this.readyState === 3; }

    private async poll(epoch: string): Promise<void> {
        if (this.epoch !== epoch || this.closed()) return;
        try {
            const result = await this.nativeInvoke<PollResult>("extension_bridge_poll", { epoch });
            if (this.epoch !== epoch || this.closed()) return;
            if (result.epoch !== epoch) { this.fail(); return; }
            if (result.connected && this.readyState === 0) {
                this.readyState = 1;
                this.onopen?.();
            }
            if (this.closed()) return;
            if (result.message !== null) this.onmessage?.({ data: result.message });
            if (this.closed()) return;
            if (result.closed) { this.close(); return; }
            this.pollTimer = setTimeout(() => {
                this.pollTimer = null;
                void this.poll(epoch);
            }, result.message === null ? 50 : 0);
        } catch { if (this.epoch === epoch) this.fail(); }
    }

    private async drain(): Promise<void> {
        if (this.sending) return;
        this.sending = true;
        const epoch = this.epoch;
        try {
            while (this.outgoing.length && this.epoch === epoch && !this.closed()) {
                const entry = this.outgoing[0];
                await this.nativeInvoke("extension_bridge_send", { epoch, text: entry.text });
                if (this.closed()) return;
                this.outgoing.shift();
                this.queuedBytes -= entry.bytes;
            }
        } catch { if (this.epoch === epoch) this.fail(); }
        finally { this.sending = false; }
    }

    private fail(): void {
        if (this.closed()) return;
        this.onerror?.();
        this.close();
    }
}
