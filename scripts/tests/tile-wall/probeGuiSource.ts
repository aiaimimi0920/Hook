import { hasTauriOrigin } from './probeOrigins.ts';
import assert from 'node:assert/strict';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { LiveCaptureStatus } from '../../../src/services/liveCapture.ts';
import type { LiveRelaySnapshot, LiveRelaySessionSummary } from '../../../src/services/liveRelay.ts';
import { connectOutput } from './artProbe.ts';
import { captureGuiSource, sourceInvoke } from './guiSourceCapture.ts';
import { openProbe, readJson, sampleJson, until, writeJson } from './probeSession.ts';

const root = path.resolve(process.argv[2]);
const { runtime, request } = await openProbe(root);
assert(runtime.sourceCdpPort && runtime.sourceHookPid && runtime.pointerExe);
const binding = await readJson<{ sourceDeviceId: string }>(path.join(root, 'source-private.json'));
assert.equal(binding.sourceDeviceId, runtime.deviceId);
const screenshots = path.resolve(root, '../../output/playwright', path.basename(root));
await mkdir(screenshots, { recursive: true });
const browser = await connectOutput(runtime.sourceCdpPort);
const page = await until(async () => browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => hasTauriOrigin(candidate.url()) && !candidate.url().includes('#tile')),
Boolean, 'ordinary packaged Hook page');
assert(page);
let relay: LiveRelaySnapshot | undefined, capture: LiveCaptureStatus | undefined;
const result: Record<string, unknown> = { passed: false, nativeSelection: true,
    publication: 'ordinary capture Unit publication button with paired device identity' };
const fixture = () => sampleJson<{ pressedKeyCount: number; pressedMouseButtons: number }>(path.join(root, 'fixture-state.json'));
try {
    const selected = await captureGuiSource(page, root, runtime.pointerExe);
    capture = selected.capture; result.selection = selected;
    await page.screenshot({ path: path.join(screenshots, 'ordinary-gui-source.png') });
    await page.keyboard.press('Tab');
    const publication = page.locator(`[data-capture-session-id="${capture.sessionId}"]`);
    await publication.getByRole('button', { name: '发布到 Loom', exact: true }).click();
    const relayId = await until(() => publication.getAttribute('data-relay-id'), Boolean, 'Unit publication owner');
    assert(relayId);
    relay = await sourceInvoke<LiveRelaySnapshot>(page, 'get_live_relay_status', { relayId });
    const captureSessionId = capture.sessionId;
    const readRelay = () => sourceInvoke<LiveRelaySnapshot>(page, 'get_live_relay_status', { relayId });
    await until(readRelay, (value) => value.connectionState === 'connected' && value.receivedFrames >= 3, 'GUI source media connected');
    const session = await request<LiveRelaySessionSummary>('GET', `/v1/live/sessions/${relay.liveSessionId}`);
    assert.equal(session.session.sourceDeviceId, runtime.deviceId); assert(session.sourceConnected);
    assert.equal(session.session.sourceHookId, captureSessionId);
    await page.screenshot({ path: path.join(screenshots, 'ordinary-gui-published.png') });
    await writeJson(path.join(root, 'input-source-ready.json'), {
        sessionId: relay.liveSessionId, captureSessionId, sourceDeviceId: runtime.deviceId,
        sourceKind: 'ordinary packaged Hook GUI with native Ctrl+2 and Unit publication button',
        executable: runtime.hookExe, pid: runtime.sourceHookPid, targets: selected.sourceTargets,
    });
    const observe = async () => {
        const [current, status, input] = await Promise.all([readRelay(),
            sourceInvoke<LiveCaptureStatus>(page, 'get_live_capture_status', { sessionId: captureSessionId }), fixture()]);
        return { frames: current.receivedFrames, lastFrameId: current.lastFrameId, remoteControlActive: current.remoteControlActive,
            interactionEnabled: status.interactionEnabled, errorCode: current.errorCode, ...input,
            inputObservation: 'owned source control events' };
    };
    const start = Date.now();
    const lifetimeMs = Math.max(600, (runtime.soakSeconds ?? 0) + 300) * 1000;
    while (Date.now() - start < lifetimeMs && !await access(path.join(root, 'stop-source')).then(() => true, () => false)) {
        await writeJson(path.join(root, 'source-status.json'), await observe());
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const timedOut = Date.now() - start >= lifetimeMs;
    const beforeCleanup = await observe();
    await publication.getByRole('button', { name: '停止发布', exact: true }).click();
    await until(() => request<LiveRelaySessionSummary>('GET', `/v1/live/sessions/${session.session.sessionId}`),
        (value) => value.closed && !value.sourceConnected, 'Unit publication stop acknowledged');
    relay = undefined;
    await sourceInvoke(page, 'stop_live_capture', { sessionId: captureSessionId }); capture = undefined;
    const cleaned = await until(fixture, (value) => value.pressedKeyCount === 0 && value.pressedMouseButtons === 0, 'GUI source input release');
    const closed = await request<LiveRelaySessionSummary>('GET', `/v1/live/sessions/${session.session.sessionId}`);
    assert(closed.closed && !closed.sourceConnected); assert(!timedOut);
    Object.assign(result, { passed: true, timedOut, workersJoined: true,
        joinEvidence: 'successful production stop_live_relay_session and stop_live_capture acknowledgements',
        beforeCleanup, afterCleanup: { ...cleaned, sessionClosed: closed.closed }, elapsedMs: Date.now() - start });
} catch (error) {
    result.error = error instanceof Error ? error.message : 'GUI source probe failed';
    await page.screenshot({ path: path.join(screenshots, 'gui-source-failure.png') }).catch(() => undefined);
    process.exitCode = 1;
} finally {
    if (relay) await sourceInvoke(page, 'stop_live_relay_session', { relayId: relay.relayId }).catch(() => undefined);
    if (capture) await sourceInvoke(page, 'stop_live_capture', { sessionId: capture.sessionId }).catch(() => undefined);
    await sourceInvoke(page, 'request_native_acceptance_exit', { marker: 'tile-gui-source-cleanup' }).catch(() => undefined);
    await browser.close();
    await writeJson(path.join(root, 'source-summary.json'), result);
}
