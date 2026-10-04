import { createSignal, onCleanup, Show, type Component } from 'solid-js';
import { liveCaptureViews } from '../store/liveCaptureStore';
import { liveRelayViews } from '../store/liveRelayStore';
import { liveRelayOwner } from '../services/liveRelayOwner';
import { api } from '../services/api';
import { liveRelayActions } from '../store/liveRelayStore';
import './UnitLivePublication.css';

/** Publication belongs to the actual capture Unit and uses its paired source identity. */
export const UnitLivePublication: Component<{ unitId: string }> = (props) => {
    const capture = () => liveCaptureViews.find((view) => view.sessionId === props.unitId);
    const source = () => liveRelayViews.find((view) => view.status.role === 'source'
        && view.status.captureSessionId === props.unitId);
    const [pending, setPending] = createSignal(false);
    const [error, setError] = createSignal('');
    let disposed = false;
    onCleanup(() => { disposed = true; });
    async function run(operation: () => Promise<void>) {
        if (pending()) return;
        setPending(true); setError('');
        try { await operation(); }
        catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { if (!disposed) setPending(false); }
    }
    async function publish() {
        const current = capture(), owner = liveRelayOwner();
        if (!current || !owner) throw new Error('实时采集或发布服务不可用');
        await owner.publish(current.sessionId, current.status.sourceTitle ?? '实时采集',
            { width: current.status.width, height: current.status.height });
    }
    async function reconnect() {
        const current = source(); if (!current) return;
        const status = await api.reconnectLiveRelaySession(current.relayId);
        if (!disposed) liveRelayActions.updateStatus(current.relayId, status);
    }
    return <Show when={capture()}>
        <section class="hook-unit-publication" aria-label="实时投射发布"
            data-capture-session-id={props.unitId} data-relay-id={source()?.relayId}>
            <strong>实时投射</strong>
            <Show when={source()} fallback={<>
                <span class="hook-inline-muted">将当前实时采集发布给已配对的 Loom。</span>
                <button type="button" class="hook-terminal-btn hook-terminal-btn--active"
                    disabled={pending() || !liveRelayOwner() || capture()?.status.captureState === 'failed'
                        || capture()?.status.captureState === 'closed'} onClick={() => void run(publish)}>
                    {pending() ? '正在发布…' : '发布到 Loom'}
                </button>
            </>}>
                {(current) => <>
                    <span role="status">{current().status.connectionState === 'connected' ? '已连接'
                        : current().status.connectionState === 'recovering' ? '恢复中'
                        : current().status.connectionState === 'closed' ? '已关闭' : '连接中'}
                        {current().status.remoteControlActive ? ' · 远端操作中' : ' · 无远端操作权'}</span>
                    <code title={current().status.liveSessionId}>{current().status.liveSessionId}</code>
                    <div class="hook-unit-publication__actions">
                        <button type="button" class="hook-terminal-btn" disabled={pending() || !liveRelayOwner()}
                            onClick={() => void run(async () => { await liveRelayOwner()?.reclaim(current().relayId); })}>收回操作权</button>
                        <button type="button" class="hook-terminal-btn" disabled={pending()}
                            onClick={() => void run(reconnect)}>重新连接</button>
                        <button type="button" class="hook-terminal-btn" disabled={pending() || !liveRelayOwner()}
                            onClick={() => void run(async () => { await liveRelayOwner()?.stop(current().relayId); })}>停止发布</button>
                    </div>
                    <Show when={current().status.errorMessage}>
                        {(message) => <span class="hook-inline-danger">{message()}</span>}
                    </Show>
                    <Show when={current().controlError}>
                        {(message) => <span class="hook-inline-danger" role="alert">{message()}</span>}
                    </Show>
                </>}
            </Show>
            <Show when={error()}>{(message) => <span class="hook-inline-danger" role="alert">{message()}</span>}</Show>
        </section>
    </Show>;
};
