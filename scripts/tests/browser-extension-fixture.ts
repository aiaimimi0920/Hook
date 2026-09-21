import { openChromiumDocument, type ChromiumDebuggerApi } from "../browser-candidate/chromiumDebuggerBinding.ts";

declare const chrome: { debugger: ChromiumDebuggerApi & {
    getTargets(): Promise<Array<{ tabId?: number; url: string }>>;
} };
export interface OwnedBrowserProbe {
    open(url: string): Promise<void>;
    capture(): Promise<string>;
    close(): Promise<void>;
}
declare global { var ownedBrowserProbe: OwnedBrowserProbe }

// Test-only extension worker. No webpage messages, external connections, native
// hosts, or installation hooks. Only the owned Playwright driver calls this API.
let binding: Awaited<ReturnType<typeof openChromiumDocument>> | undefined;
let read: (() => Promise<string>) | undefined;
globalThis.ownedBrowserProbe = {
    async open(url) {
        if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) throw new Error("OWNED_FIXTURE_ONLY");
        if (binding) throw new Error("FIXTURE_ALREADY_BOUND");
        const matches = (await chrome.debugger.getTargets()).filter((item) => item.url === url);
        if (matches.length !== 1 || matches[0].tabId === undefined) throw new Error("AMBIGUOUS_FIXTURE_TAB");
        binding = await openChromiumDocument(chrome.debugger, matches[0].tabId, new AbortController().signal);
        read = binding.bind({ x: 40, y: 120, width: 320, height: 160 });
    },
    capture() { if (!read) throw new Error("FIXTURE_NOT_BOUND"); return read(); },
    async close() { await binding?.close(); binding = undefined; read = undefined; },
};
