// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { UnitLiveViewer } from '../../src/components/UnitLiveViewer';
import { api } from '../../src/services/api';
import { createLiveRelayController, type LiveRelayController } from '../../src/services/liveRelayController';
import { registerLiveRelayOwner } from '../../src/services/liveRelayOwner';
import { liveRelayActions, liveRelayViews } from '../../src/store/liveRelayStore';
import { surfaceStore } from '../../src/store/surfaceStore';
import { deferred, relayBinding, relaySession, relayStatus, relaySurface } from '../fixtures/liveRelay';
import type { LiveRelaySnapshot } from '../../src/services/liveRelay';

vi.mock('../../src/services/api', () => ({ api: {
    discoverLiveRelaySessions: vi.fn(), requestLiveRelayPairing: vi.fn(), joinLiveRelaySession: vi.fn(), stopLiveRelaySession: vi.fn(),
    pollLiveRelayFrame: vi.fn(), changeLiveRelayController: vi.fn(),
} }));
let controller: LiveRelayController;
let unmount: (() => void) | undefined;
let unregister: () => void;
const button = (label: string) => [...document.querySelectorAll('button')].find((item) => item.textContent === label)!;
const choose = () => {
    const select = document.querySelector('select')!;
    select.value = 'live:a';
    select.dispatchEvent(new Event('change', { bubbles: true }));
};
async function open() {
    unmount = render(() => <UnitLiveViewer unitId="unit:a" />, document.body);
    button('刷新列表').click();
    await vi.waitFor(() => expect(document.querySelector('select')).not.toBeNull());
    choose();
}
beforeEach(() => {
    vi.resetAllMocks();
    liveRelayActions.clear();
    surfaceStore.actions.clearAll();
    surfaceStore.actions.mountSnapshot('unit:a', relaySurface, 3);
    vi.mocked(api.discoverLiveRelaySessions).mockResolvedValue({ protocolVersion: 'loom.live.v1', sessions: [relaySession] });
    vi.mocked(api.joinLiveRelaySession).mockResolvedValue({ ...relayStatus });
    vi.mocked(api.stopLiveRelaySession).mockResolvedValue(undefined);
    vi.mocked(api.requestLiveRelayPairing).mockResolvedValue(undefined);
    vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status: { ...relayStatus } });
    controller = createLiveRelayController();
    unregister = registerLiveRelayOwner(controller);
});
afterEach(() => {
    unmount?.(); unmount = undefined;
    unregister(); controller.dispose();
    surfaceStore.actions.clearAll(); document.body.replaceChildren();
});

it('requires explicit discovery, selection and joining with the mounted attachment, without acquiring control', async () => {
    unmount = render(() => <UnitLiveViewer unitId="unit:a" />, document.body);
    expect(api.discoverLiveRelaySessions).not.toHaveBeenCalled();
    button('刷新列表').click();
    await vi.waitFor(() => expect(document.querySelector('select')).not.toBeNull());
    expect(button('加入观看').disabled).toBe(true);
    choose(); button('加入观看').click(); button('加入观看').click();
    await vi.waitFor(() => expect(liveRelayViews).toHaveLength(1));
    expect(api.joinLiveRelaySession).toHaveBeenCalledExactlyOnceWith({
        liveSessionId: 'live:a', surfaceInstanceId: 'instance:a', attachmentId: 'attachment:a',
    });
    expect(api.changeLiveRelayController).not.toHaveBeenCalled();
    expect(liveRelayViews[0].sourceIdentity).toEqual({ deviceId: 'source:a', hookId: 'hook:a' });
    expect(document.body.textContent).toContain('观看窗口已打开');
    unmount(); unmount = undefined;
    expect(liveRelayViews).toHaveLength(1);
    expect(api.stopLiveRelaySession).not.toHaveBeenCalled();
});

it('disables joining without a mounted or live attachment', async () => {
    surfaceStore.actions.clearAll();
    await open();
    expect(button('加入观看').disabled).toBe(true);
    expect(document.body.textContent).toContain('等待当前 Art 的 Surface 挂载');
    surfaceStore.actions.mountSnapshot('unit:a', relaySurface);
    surfaceStore.actions.applyLifecycle('unit:a', { protocolVersion: relaySurface.protocolVersion,
        instanceId: relaySurface.instanceId, attachmentId: relaySurface.attachmentId, state: 'disposed', revision: 2 });
    expect(button('加入观看').disabled).toBe(true);
    expect(api.joinLiveRelaySession).not.toHaveBeenCalled();
});

it.each(['unmount', 'generation', 'attachment', 'dispose-owner'] as const)('cleans a late join after %s without tracking pixels', async (change) => {
    const pending = deferred<LiveRelaySnapshot>();
    vi.mocked(api.joinLiveRelaySession).mockReturnValue(pending.promise);
    await open(); button('加入观看').click();
    expect(api.joinLiveRelaySession).toHaveBeenCalledTimes(1);
    if (change === 'unmount') { unmount?.(); unmount = undefined; }
    if (change === 'generation') surfaceStore.actions.setGeneration('unit:a', 4);
    if (change === 'attachment') surfaceStore.actions.mountSnapshot('unit:a', { ...relaySurface, attachmentId: 'attachment:b' }, 3);
    if (change === 'dispose-owner') controller.dispose();
    pending.resolve({ ...relayStatus });
    await vi.waitFor(() => expect(api.stopLiveRelaySession).toHaveBeenCalledExactlyOnceWith('relay:a'));
    expect(liveRelayViews).toHaveLength(0);
    expect(api.pollLiveRelayFrame).not.toHaveBeenCalled();
});

it('shows discovery failures and supports a clean explicit retry and empty state', async () => {
    vi.mocked(api.discoverLiveRelaySessions).mockRejectedValueOnce(new Error('discovery denied'));
    unmount = render(() => <UnitLiveViewer unitId="unit:a" />, document.body);
    button('刷新列表').click();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toBe('discovery denied'));
    vi.mocked(api.discoverLiveRelaySessions).mockResolvedValue({ protocolVersion: 'loom.live.v1', sessions: [] });
    button('刷新列表').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('暂无可观看'));
    expect(document.querySelector('[role="alert"]')).toBeNull();
});

it('preserves server rejection and releases admission for a retry', async () => {
    vi.mocked(api.joinLiveRelaySession).mockRejectedValueOnce(new Error('live_attachment_identity_mismatch'));
    await open(); button('加入观看').click();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toBe('live_attachment_identity_mismatch'));
    expect(liveRelayViews).toHaveLength(0);
    button('加入观看').click();
    await vi.waitFor(() => expect(liveRelayViews).toHaveLength(1));
});

it('filters closed and locally published sessions and disables disconnected sources', async () => {
    liveRelayActions.add({ ...relayStatus, role: 'source' }, 'Local', { x: 0, y: 0, width: 4, height: 4 });
    vi.mocked(api.discoverLiveRelaySessions).mockResolvedValue({ protocolVersion: 'loom.live.v1', sessions: [
        relaySession, { ...relaySession, closed: true, session: { ...relaySession.session, sessionId: 'closed' } },
        { ...relaySession, sourceConnected: false, session: { ...relaySession.session, sessionId: 'offline' } },
    ] });
    await open();
    expect([...document.querySelectorAll('option')].map((entry) => entry.value)).toEqual(['', 'offline']);
    const select = document.querySelector('select')!; select.value = 'offline';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(button('加入观看').disabled).toBe(true);
    expect(document.body.textContent).toContain('源尚未连接');
});

it('rejects duplicate joins across panels and bounds distinct pending joins', async () => {
    const pending = deferred<LiveRelaySnapshot>();
    vi.mocked(api.joinLiveRelaySession).mockReturnValue(pending.promise);
    const first = controller.join(relaySession, relayBinding);
    await expect(controller.join(relaySession, relayBinding)).rejects.toThrow('正在加入');
    const others = [1, 2, 3].map((id) => controller.join({ ...relaySession,
        session: { ...relaySession.session, sessionId: `live:${id}` } }, relayBinding));
    await expect(controller.join({ ...relaySession, session: { ...relaySession.session, sessionId: 'live:limit' } }, relayBinding))
        .rejects.toThrow('请求过多');
    expect(api.joinLiveRelaySession).toHaveBeenCalledTimes(4);
    controller.dispose(); pending.resolve({ ...relayStatus });
    await Promise.all([first, ...others]);
    expect(liveRelayViews).toHaveLength(0);
});

it('never starts a closed or stale join', async () => {
    await controller.join(relaySession, relayBinding, () => false);
    await expect(controller.join({ ...relaySession, closed: true }, relayBinding)).rejects.toThrow('已关闭');
    expect(api.joinLiveRelaySession).not.toHaveBeenCalled();
});

it('re-pairs only after an explicit click and neither discovers, joins, controls nor removes the old relay', async () => {
    const old = { ...relayStatus, connectionState: 'closed' as const, errorCode: 'live_media_device_revoked' };
    liveRelayActions.add(old, 'Revoked', { x: 0, y: 0, width: 4, height: 4 });
    unmount = render(() => <UnitLiveViewer unitId="unit:a" />, document.body);
    expect(api.requestLiveRelayPairing).not.toHaveBeenCalled();
    button('重新配对').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('配对请求已提交'));
    expect(api.requestLiveRelayPairing).toHaveBeenCalledTimes(1);
    expect(api.discoverLiveRelaySessions).not.toHaveBeenCalled();
    expect(api.joinLiveRelaySession).not.toHaveBeenCalled();
    expect(api.changeLiveRelayController).not.toHaveBeenCalled();
    expect(api.stopLiveRelaySession).not.toHaveBeenCalled();
    expect(liveRelayViews[0].status).toEqual(old);
});

it('bounds pairing admission and exposes failure before an explicit retry', async () => {
    const pending = deferred<void>();
    vi.mocked(api.requestLiveRelayPairing).mockReturnValueOnce(pending.promise);
    unmount = render(() => <UnitLiveViewer unitId="unit:a" />, document.body);
    button('重新配对').click();
    expect(button('重新配对').disabled).toBe(true);
    expect([...document.querySelectorAll('button')].every((item) => item.disabled)).toBe(true);
    button('重新配对').click();
    pending.reject(new Error('pairing denied'));
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toBe('pairing denied'));
    button('重新配对').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('配对请求已提交'));
    expect(api.requestLiveRelayPairing).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
});

it.each(['unmount', 'replace-owner'] as const)('ignores a late pairing result after %s', async (change) => {
    const pending = deferred<void>();
    vi.mocked(api.requestLiveRelayPairing).mockReturnValueOnce(pending.promise);
    unmount = render(() => <UnitLiveViewer unitId="unit:a" />, document.body);
    button('重新配对').click();
    if (change === 'unmount') { unmount?.(); unmount = undefined; }
    else { unregister(); controller.dispose(); controller = createLiveRelayController(); unregister = registerLiveRelayOwner(controller); }
    pending.resolve();
    await pending.promise; await Promise.resolve();
    expect(document.body.textContent).not.toContain('配对请求已提交');
    expect(api.discoverLiveRelaySessions).not.toHaveBeenCalled();
    expect(api.joinLiveRelaySession).not.toHaveBeenCalled();
});

it('allows a new viewer for the same live session while preserving a revoked terminal viewer', async () => {
    const old = { ...relayStatus, connectionState: 'closed' as const, errorCode: 'live_media_device_revoked' };
    liveRelayActions.add(old, 'Revoked', { x: 0, y: 0, width: 4, height: 4 });
    vi.mocked(api.joinLiveRelaySession).mockResolvedValue({ ...relayStatus, relayId: 'relay:new' });
    vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status: { ...relayStatus, relayId: 'relay:new' } });
    await open();
    expect(button('加入观看').disabled).toBe(false);
    button('加入观看').click();
    await vi.waitFor(() => expect(liveRelayViews).toHaveLength(2));
    expect(liveRelayViews[0].status).toEqual(old);
    expect(liveRelayViews[0].imageUrl).toBeUndefined();
    expect(liveRelayViews[1].relayId).toBe('relay:new');
    expect(button('加入观看').disabled).toBe(true);
    await controller.join(relaySession, relayBinding);
    expect(api.joinLiveRelaySession).toHaveBeenCalledTimes(1);
});

it('still deduplicates a recovering viewer and suppresses joining without an owner', async () => {
    liveRelayActions.add({ ...relayStatus, connectionState: 'recovering' }, 'Recovering', { x: 0, y: 0, width: 4, height: 4 });
    await open();
    expect(button('加入观看').disabled).toBe(true);
    await controller.join(relaySession, relayBinding);
    expect(api.joinLiveRelaySession).not.toHaveBeenCalled();
    unregister();
    expect(button('重新配对').disabled).toBe(true);
});
