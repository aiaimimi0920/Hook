import { createMemo, createSignal, For, onCleanup, Show, type Component } from 'solid-js';
import { liveRelayOwner } from '../services/liveRelayOwner';
import { liveRelayDiscovery, liveRelayViews } from '../store/liveRelayStore';
import { surfaceStore } from '../store/surfaceStore';
import './UnitLiveViewer.css';

/** 复用 Surface 观看；重新配对只显式提交请求，不批准或申请输入权。 */
export const UnitLiveViewer: Component<{ unitId: string }> = (props) => {
    const surface = () => surfaceStore.byUnit[props.unitId];
    const available = () => !!surface() && surface().lifecycle !== 'disposed';
    const [pending, setPending] = createSignal(false);
    const [loaded, setLoaded] = createSignal(false);
    const [selectedId, setSelectedId] = createSignal('');
    const [error, setError] = createSignal('');
    const [pairingNotice, setPairingNotice] = createSignal('');
    const sessions = createMemo(() => liveRelayDiscovery.sessions.filter((entry) => !entry.closed
        && !liveRelayViews.some((view) => view.status.role === 'source'
            && view.status.liveSessionId === entry.session.sessionId)));
    const selected = () => sessions().find((entry) => entry.session.sessionId === selectedId());
    const joined = () => liveRelayViews.some((view) => view.status.liveSessionId === selectedId()
        && view.status.connectionState !== 'closed');
    let disposed = false;
    onCleanup(() => { disposed = true; });

    async function run(operation: () => Promise<void>) {
        if (pending() || disposed) return;
        setPending(true);
        setError('');
        setPairingNotice('');
        try { await operation(); }
        catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { if (!disposed) setPending(false); }
    }
    async function refresh() {
        const owner = liveRelayOwner();
        if (!owner) throw new Error('实时投射服务不可用');
        setLoaded(false);
        setSelectedId('');
        await owner.discover();
        if (!disposed && owner === liveRelayOwner()) setLoaded(true);
    }
    async function requestPairing() {
        const owner = liveRelayOwner();
        if (!owner) throw new Error('实时投射服务不可用');
        setLoaded(false);
        setSelectedId('');
        await owner.requestPairing();
        if (!disposed && owner === liveRelayOwner()) {
            setPairingNotice('配对请求已提交，请在 Loom 批准后刷新列表。');
        }
    }
    async function join() {
        const owner = liveRelayOwner(), entry = selected(), current = surface();
        if (!owner || !entry || !current || !available()) throw new Error('观看绑定不可用，请等待 Surface 挂载');
        const unitId = props.unitId, generation = current.generation;
        const { instanceId, attachmentId } = current.snapshot;
        const stillCurrent = () => !disposed && owner === liveRelayOwner() && props.unitId === unitId
            && available() && surface().generation === generation
            && surface().snapshot.instanceId === instanceId && surface().snapshot.attachmentId === attachmentId;
        await owner.join(entry, { unitId, instanceId, attachmentId, label: '实时投射观看' }, stillCurrent);
        if (!disposed && !stillCurrent()) setError('Surface 绑定已变化，请重新加入');
    }

    return <section class="hook-unit-live-viewer" aria-label="实时投射观看" aria-busy={pending()}>
        <header><strong>实时投射</strong><div class="hook-unit-live-viewer-actions">
            <button type="button" class="hook-terminal-btn" disabled={pending() || !liveRelayOwner()}
                onClick={() => void run(requestPairing)}>重新配对</button>
            <button type="button" class="hook-terminal-btn" disabled={pending() || !liveRelayOwner()}
                onClick={() => void run(refresh)}>{pending() ? '处理中…' : '刷新列表'}</button>
        </div></header>
        <span class="hook-inline-muted">通过当前 Loom 与 Surface 加入观看；控制权需另行申请。</span>
        <Show when={!available()}><span role="status">等待当前 Art 的 Surface 挂载。</span></Show>
        <Show when={pairingNotice()}>{(message) => <span role="status">{message()}</span>}</Show>
        <Show when={loaded()} fallback={<span class="hook-inline-muted">刷新以查找可用会话。</span>}>
            <Show when={sessions().length} fallback={<span role="status">暂无可观看的实时投射。</span>}>
                <select class="hook-terminal-input" aria-label="选择实时投射" value={selectedId()}
                    disabled={pending()} onChange={(event) => setSelectedId(event.currentTarget.value)}>
                    <option value="">请选择会话</option>
                    <For each={sessions()}>{(entry) => <option value={entry.session.sessionId}>
                        {entry.session.sourceWindowIdentity.title || entry.session.sourceHookId} · {entry.session.sourceDeviceId}
                    </option>}</For>
                </select>
                <Show when={selected()}>{(entry) => <>
                    <code title={entry().session.sessionId}>{entry().session.sessionId}</code>
                    <span role="status">{joined() ? '观看窗口已打开' : entry().sourceConnected ? '源已连接' : '源尚未连接'}</span>
                </>}</Show>
                <button type="button" class="hook-terminal-btn hook-terminal-btn--active"
                    disabled={pending() || !available() || !liveRelayOwner() || !selected()?.sourceConnected || joined()}
                    onClick={() => void run(join)}>加入观看</button>
            </Show>
        </Show>
        <Show when={error()}>{(message) => <span class="hook-inline-danger" role="alert">{message()}</span>}</Show>
    </section>;
};
