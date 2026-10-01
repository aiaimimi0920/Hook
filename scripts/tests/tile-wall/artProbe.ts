import { loopbackHttpOrigin } from './probeOrigins.ts';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import type { SurfaceActionAck, SurfaceResultCommit, SurfaceSnapshot } from '../../../src/services/surfaceProtocol.ts';
import { until } from './probeSession.ts';

export interface ArtSource { instanceId: string; attachmentId: string }
export interface ArtSources { form: ArtSource; dashboard: ArtSource }
export interface ArtRecord {
    descriptor: { instanceId: string; generation: number };
    attachments: Record<string, { ephemeral?: boolean; snapshot?: SurfaceSnapshot }>;
    eventAcks: Record<string, SurfaceActionAck>;
    pendingEvents: unknown[];
    latestResult?: SurfaceResultCommit;
}

export function sourceSnapshot(record: ArtRecord, source: ArtSource): SurfaceSnapshot {
    const snapshot = record.attachments[source.attachmentId]?.snapshot;
    assert(snapshot, 'ordinary source attachment must remain mounted');
    return snapshot;
}

export function art(page: Page, placement = 'form-a') {
    return page.locator(`[data-surface-unit-id="tile:${placement}"]`);
}

export async function connectOutput(port: number) {
    const origin = loopbackHttpOrigin(port);
    await until(async () => {
        try { return (await fetch(origin + '/json/version', { signal: AbortSignal.timeout(1000), redirect: 'error' })).ok; }
        catch { return false; }
    }, Boolean, 'owned WebView2 CDP');
    return chromium.connectOverCDP(origin);
}

export async function exitTile(page: Page) {
    await page.evaluate(() => (window as unknown as { __TAURI_INTERNALS__: { invoke: (name: string) => Promise<void> } })
        .__TAURI_INTERNALS__.invoke('tile_exit')).catch((error: unknown) => {
            if (!(error instanceof Error) || !/closed|destroyed/i.test(error.message)) throw error;
        });
}

export async function screenshotPixels(page: Page, points: readonly { x: number; y: number }[]) {
    const screenshot = await page.screenshot({ scale: 'css' });
    return page.evaluate(async ({ png, points }) => {
        const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        try {
            const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return points.map(({ x, y }) => [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data]);
        } finally { image.close(); }
    }, { png: screenshot.toString('base64'), points });
}
