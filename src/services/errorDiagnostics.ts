import { api } from "./api";

/**
 * Installs global error diagnostics that do NOT depend on the async Tauri IPC
 * surviving a synchronous webview crash. Captures uncaught errors and unhandled
 * rejections three ways:
 *   1. Persist to localStorage synchronously (survives a reload/crash).
 *   2. Paint a visible on-screen overlay with the full message + stack.
 *   3. Best-effort async debugLogEvent (kept for when it does survive).
 *
 * Returns a disposer that removes the window listeners. Mirrors the behavior
 * that previously lived inline in App's onMount.
 */
const DIAGNOSTIC_STORAGE_KEY = "hook-last-error";
const DIAGNOSTIC_OVERLAY_ID = "hook-error-overlay";

export function installErrorDiagnostics(tauriRuntimeAvailable: boolean): () => void {
    const persistDiagnostic = (kind: string, detail: string) => {
        const entry = `[${new Date().toISOString()}] ${kind}\n${detail}`;
        try {
            const prev = window.localStorage.getItem(DIAGNOSTIC_STORAGE_KEY) ?? "";
            window.localStorage.setItem(
                DIAGNOSTIC_STORAGE_KEY,
                `${entry}\n\n----\n${prev}`.slice(0, 16000),
            );
        } catch {
            /* localStorage may be unavailable; ignore */
        }
        try {
            let overlay = document.getElementById(DIAGNOSTIC_OVERLAY_ID);
            if (!overlay) {
                overlay = document.createElement("div");
                overlay.id = DIAGNOSTIC_OVERLAY_ID;
                overlay.setAttribute(
                    "style",
                    "position:fixed;left:8px;right:8px;bottom:8px;max-height:45vh;overflow:auto;z-index:2147483647;background:rgba(120,0,0,0.92);color:#fff;font:11px/1.4 monospace;white-space:pre-wrap;padding:10px 12px;border-radius:8px;pointer-events:auto;",
                );
                overlay.addEventListener("click", () => overlay?.remove());
                document.body.appendChild(overlay);
            }
            overlay.textContent = `${kind} (click to dismiss)\n\n${detail}`;
        } catch {
            /* DOM may be unavailable; ignore */
        }
        if (tauriRuntimeAvailable) {
            void api.debugLogEvent(kind, detail);
        }
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
        console.error("[Hook] Unhandled promise rejection (suppressed):", event.reason);
        event.preventDefault();
        const reason = event.reason;
        const detail =
            reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason);
        persistDiagnostic("unhandled-rejection", detail);
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    const onWindowError = (event: ErrorEvent) => {
        console.error("[Hook] Uncaught error:", event.error ?? event.message);
        const err = event.error;
        const detail =
            err instanceof Error
                ? `${err.message}\n${err.stack ?? ""}`
                : `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`;
        persistDiagnostic("uncaught-error", detail);
    };
    window.addEventListener("error", onWindowError);

    return () => {
        window.removeEventListener("unhandledrejection", onUnhandledRejection);
        window.removeEventListener("error", onWindowError);
    };
}
