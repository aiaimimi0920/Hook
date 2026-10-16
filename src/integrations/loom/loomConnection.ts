import { invoke } from "@tauri-apps/api/core";
import { createSignal, onCleanup, onMount } from "solid-js";

export interface LoomInfo {
    protocolVersion: string; loomId: string; name: string; endpoint: string | null;
    discoverable: boolean; approval: "manual" | "lan" | "password" | "authenticated"; passwordRequired: boolean;
}
export interface LoomTarget { origin: string; name: string; loomId: string; certificate?: string | null }
export interface LoomConnectionState {
    phase: "disconnected" | "connecting" | "waiting" | "connected";
    loomId: string | null; name: string | null; origin: string | null; error: string | null; expiresAt: number;
}
const idle: LoomConnectionState = { phase: "disconnected", loomId: null, name: null, origin: null, error: null, expiresAt: 0 };
const [snapshot, setSnapshot] = createSignal<LoomConnectionState>(idle);
const [history, setHistory] = createSignal<LoomTarget[]>([]);
const [clock, setClock] = createSignal(Date.now());
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let reading = false;
let generation = 0;
export const loomConnectionState = () => snapshot().phase === "connected" && snapshot().expiresAt <= clock()
    ? { ...idle, error: "Loom 连接已过期" } : snapshot();
export const loomConnectionHistory = history;

export async function refreshLoomConnection(): Promise<void> {
    if (reading) return;
    reading = true;
    const current = generation;
    try {
        const result = await invoke<{ state: LoomConnectionState; history: LoomTarget[] }>("loom_connection_view");
        if (current === generation) { setSnapshot(result.state); setHistory(result.history); }
    } catch (error) { if (current === generation) setSnapshot({ ...idle, error: String(error) }); }
    finally { reading = false; setClock(Date.now()); }
}
export function useLoomConnection(): void {
    onMount(() => {
        if (++users === 1) {
            void refreshLoomConnection();
            timer = setInterval(() => { setClock(Date.now()); void refreshLoomConnection(); }, 1000);
        }
        onCleanup(() => { if (--users === 0) { clearInterval(timer); timer = undefined; } });
    });
}
export const discoverLoom = () => invoke<LoomTarget[]>("loom_connection_discover");
export const probeLoom = (origin: string) => invoke<LoomInfo>("loom_connection_probe", { origin });
export const prepareDiscoveredLoom = (target: LoomTarget) => invoke<{ origin: string; info: LoomInfo }>("loom_connection_prepare_discovered", { origin: target.origin, loomId: target.loomId, certificate: target.certificate });
export async function connectLoom(origin: string, expectedId: string, password: string): Promise<void> {
    const current = ++generation;
    setSnapshot({ ...idle, phase: "connecting", origin });
    try { await invoke("loom_connection_connect", { origin, expectedId, password }); }
    catch (error) { if (current === generation) setSnapshot({ ...idle, error: String(error) }); throw error; }
    finally { await refreshLoomConnection(); }
}
export async function disconnectLoom(): Promise<void> {
    generation++;
    setSnapshot(idle);
    await invoke("loom_connection_disconnect");
    await refreshLoomConnection();
}

export function loomManualOrigin(host: string, port: string): string {
    const address = host.trim();
    const number = Number(port);
    if (!address || !/^\d{1,5}$/.test(port) || number < 1 || number > 65535 || /[\s/@?#]/.test(address)) throw new Error("请输入有效的 IP / 主机名和端口");
    const bare = address.replace(/^\[|\]$/g, "");
    const scheme = ["localhost", "127.0.0.1", "::1"].includes(bare.toLowerCase()) ? "http" : "https";
    return `${scheme}://${bare.includes(":") ? `[${bare}]` : bare}:${number}`;
}
