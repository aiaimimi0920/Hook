// System history is read-only and transient; never persist it into workspace history.
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntimeAvailable, safeInvoke } from "../../../platform/tauri/apiTransport";

export interface SystemClipboardEntry {
    id: string;
    kind: "text" | "image";
    content: string;
    preview?: string;
}
export interface SystemClipboardSnapshot {
    status: "ready" | "disabled" | "denied" | "unsupported";
    monitoring: boolean;
    entries: SystemClipboardEntry[];
}
export const readSystemClipboardHistory = () => safeInvoke<SystemClipboardSnapshot>(
    "read_system_clipboard_history", undefined, () => ({ status: "unsupported", entries: [], monitoring: false }),
);
export const listenSystemClipboard = async (changed: () => void) => {
    if (!isTauriRuntimeAvailable()) return () => undefined;
    return listen("system-clipboard-changed", changed);
};
