import { assertProbeRoute, loopbackHttpOrigin } from './probeOrigins.ts';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ProbeRuntime {
    daemonBaseUrl: string;
    daemonPid: number;
    hookPid: number;
    hookExe: string;
    daemonExe: string;
    cdpPort: number;
    outputCdpPort: number;
    outputPid?: number;
    deviceId?: string;
    loomCdpPort?: number;
    loomPid?: number;
    loomExe?: string;
    sourceCdpPort?: number;
    sourceHookPid?: number;
    pointerExe?: string;
    soakSeconds?: number;
}

export async function readJson<T>(file: string): Promise<T> {
    return JSON.parse(await readFile(file, 'utf8')) as T;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
    await writeFile(file, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

export async function openProbe(root: string) {
    const runtime = await readJson<ProbeRuntime>(path.join(root, 'runtime.json'));
    const manifest = await readJson<{ transport: { baseUrl: string; authToken: string } }>(path.join(root, 'manifest', 'loom.json'));
    const origin = new URL(runtime.daemonBaseUrl);
    if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:' || !origin.port
        || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash
        || manifest.transport.baseUrl !== runtime.daemonBaseUrl || !manifest.transport.authToken) {
        throw new Error('Probe must use its own loopback manifest and administrator credential');
    }
    // Capture the validated origin once; callers cannot redirect requests by mutating runtime.
    const baseUrl = loopbackHttpOrigin(Number(origin.port));
    async function request<T>(method: string, route: string, body?: unknown, admin = true): Promise<T> {
        assertProbeRoute(route);
        const response = await fetch(baseUrl + route, {
            method, signal: AbortSignal.timeout(15000), redirect: 'error',
            headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${manifest.transport.authToken}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        // Never include arbitrary response text or credentials in fixture failures.
        if (!response.ok) throw new Error(`Probe request failed: ${method} ${route.split('?')[0]} HTTP ${response.status}`);
        return await response.json() as T;
    }
    return { runtime, request };
}

export async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeout = 20000): Promise<T> {
    const end = performance.now() + timeout;
    while (performance.now() < end) {
        const value = await read();
        if (accept(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Probe timed out: ${label}`);
}

export async function sampleJson<T>(file: string): Promise<T> {
    // The existing WinForms/native fixtures write small status files in place.
    for (let attempt = 0; attempt < 20; attempt++) {
        try { return await readJson<T>(file); }
        catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    throw new Error('Probe status file did not become readable');
}
