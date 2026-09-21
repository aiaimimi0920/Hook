import { createDocumentBinding, type BrowserEvent, type BrowserTransport } from "./documentBinding.ts";

type Debuggee = { tabId?: number; sessionId?: string };
type EventListener = (source: Debuggee, method: string, params?: unknown) => void;
type DetachListener = (source: Debuggee, reason: string) => void;
interface Listeners<T> { addListener(listener: T): void; removeListener(listener: T): void }
export interface ChromiumDebuggerApi {
    attach(target: { tabId: number }, version: string): Promise<void>;
    detach(target: { tabId: number }): Promise<void>;
    sendCommand(target: { tabId: number }, method: string, params?: object): Promise<unknown>;
    onEvent: Listeners<EventListener>;
    onDetach: Listeners<DetachListener>;
}

const owners = new WeakMap<ChromiumDebuggerApi, Set<number>>();

// Invoke only after the extension's explicit tab grant. This module is transport,
// not permission acquisition: it never enumerates tabs or opens a debugging port.
export async function openChromiumDocument(
    api: ChromiumDebuggerApi, tabId: number, signal: AbortSignal, timeoutMs = 5000,
) {
    if (!Number.isSafeInteger(tabId) || tabId < 0 || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
        throw new Error("BROWSER_INVALID_TARGET");
    }
    if (signal.aborted) throw new Error("BROWSER_BINDING_REVOKED");
    const reserved = owners.get(api) ?? new Set<number>();
    owners.set(api, reserved);
    if (reserved.has(tabId)) throw new Error("BROWSER_TARGET_BUSY");
    reserved.add(tabId);
    const target = { tabId };
    const listeners = new Map<BrowserEvent, Set<(payload: unknown) => void>>();
    let attached = false;
    let attachSettled = false;
    let ended = false;
    let detachTask: Promise<void> | undefined;
    let rejectAttach!: (error: Error) => void;
    const interrupted = new Promise<never>((_, reject) => { rejectAttach = reject; });
    function emit(event: BrowserEvent, payload: unknown) {
        for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
    }
    const event: EventListener = (source, method, params) => {
        if (source.tabId !== tabId || source.sessionId || ended) return;
        if (method === "Page.frameNavigated" || method === "Page.frameStartedLoading" || method === "Inspector.detached") {
            emit(method, params);
        }
    };
    const detached: DetachListener = (source) => {
        if (source.tabId !== tabId || source.sessionId) return;
        attached = false;
        if (attachSettled) reserved.delete(tabId);
        void stop();
    };
    function releaseListeners() {
        api.onEvent.removeListener(event);
        api.onDetach.removeListener(detached);
        signal.removeEventListener("abort", abort);
    }
    function detachOwned() {
        if (!detachTask && attached) {
            attached = false;
            detachTask = Promise.resolve().then(() => api.detach(target)).finally(() => { reserved.delete(tabId); });
        }
        return detachTask ?? Promise.resolve();
    }
    function stop(reason = "BROWSER_BINDING_REVOKED") {
        if (!ended) {
            ended = true;
            rejectAttach(new Error(reason));
            releaseListeners();
            emit("close", undefined);
            listeners.clear();
        }
        return detachOwned();
    }
    function abort() { void stop().catch(() => undefined); }
    api.onEvent.addListener(event);
    api.onDetach.addListener(detached);
    signal.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(() => { void stop("BROWSER_ATTACH_TIMEOUT").catch(() => undefined); }, timeoutMs);
    // An attach which succeeds after revocation still belongs to us. Keep the
    // reservation until it settles, then detach; never leak a late attachment.
    const attaching = Promise.resolve().then(() => {
        if (ended) throw new Error("BROWSER_BINDING_REVOKED");
        return api.attach(target, "1.3");
    }).then(async () => {
        attachSettled = true;
        attached = true;
        if (ended) { await detachOwned(); throw new Error("BROWSER_BINDING_REVOKED"); }
    }, (error: unknown) => { attachSettled = true; reserved.delete(tabId); throw error; });
    try {
        await Promise.race([attaching, interrupted]);
        clearTimeout(deadline);
        const transport: BrowserTransport = {
            request(method, params) {
                if (ended) return Promise.reject(new Error("BROWSER_BINDING_REVOKED"));
                return api.sendCommand(target, method, params);
            },
            subscribe(name, listener) {
                const group = listeners.get(name) ?? new Set();
                group.add(listener); listeners.set(name, group);
                return () => { group.delete(listener); if (!group.size) listeners.delete(name); };
            },
            detach: stop,
        };
        return await createDocumentBinding(transport, timeoutMs);
    } catch (error) {
        await stop().catch(() => undefined);
        throw error;
    } finally { clearTimeout(deadline); }
}
