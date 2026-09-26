import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { graphStore } from "../store/graphStore";
import { openProjectionReceiver, projectionStatuses, projectionStatusLabel } from "../store/qrProjectionStore";
import { api } from "../services/api";
import { projectionAccountContext, projectionCode, requestProjection } from "../services/qrProjectionApi";
import type { ProjectionAccountContext } from "../types/qrProjection";
import { queueProjectionUnlink } from "../services/qrProjectionCleanup";
import { onProjectionUnitRemoved, projectionWorkspaceGeneration } from "../services/qrProjectionLifecycle";
import { isProjectionLoopback, projectionError, projectionOrigin, PROJECTION_PROTOCOL_V2 } from "../services/qrProjectionProtocol";
import { patchProjection, projectionLinkFromResponse } from "../services/qrProjectionSession";
import { renderProjectionFrame } from "../services/qrProjectionSnapshot";

export const QrProjectionSender = (props: { unitId: string; retry: (id: string) => void }) => {
    const unit = () => graphStore.units.find((item) => item.id === props.unitId);
    const link = () => {
        const saved = unit()?.data.qrProjection;
        return saved?.localUnitId === props.unitId && (saved.role === "receiver" || saved.envelope.source.unitId === props.unitId) ? saved : undefined;
    };
    const [origin, setOrigin] = createSignal("");
    const [account, setAccount] = createSignal<ProjectionAccountContext>();
    const [accountLoading, setAccountLoading] = createSignal(false);
    const legacy = () => link()?.envelope.protocol === "neuro.qr-projection.v1";
    const [qr, setQr] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const [copied, setCopied] = createSignal(false);
    const [now, setNow] = createSignal(Date.now());
    let alive = true;
    let sourceLifetime = 0;
    createEffect(() => {
        const unitId = props.unitId;
        sourceLifetime += 1;
        onCleanup(onProjectionUnitRemoved((id) => { if (id === unitId) sourceLifetime += 1; }));
    });
    const remaining = () => Math.max(0, Math.ceil(((link()?.envelope.expiresAtMs ?? 0) - now()) / 1000));
    const loopback = () => { try { return isProjectionLoopback(projectionOrigin(origin())); } catch { return false; } };
    const refreshAccount = async () => {
        if (legacy() || accountLoading()) return;
        setAccountLoading(true); setError("");
        try {
            const value = await projectionAccountContext();
            if (alive && !legacy()) { setAccount(value); if (!link()) setOrigin(value.origin); }
        } catch (reason) { if (alive) { setAccount(undefined); setError(projectionError(reason)); } }
        finally { if (alive) setAccountLoading(false); }
    };
    onMount(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        onCleanup(() => clearInterval(timer));
        void refreshAccount();
    });
    onCleanup(() => { alive = false; });
    createEffect(() => {
        const saved = link();
        setQr("");
        if (!saved) return;
        setOrigin(saved.envelope.serverOrigin);
        if (saved.role !== "source" || saved.stopped || saved.stopPending || saved.linked) return;
        let current = true;
        onCleanup(() => { current = false; });
        void projectionCode(saved.envelope).then((value) => { if (current && alive) setQr(value); })
            .catch((reason: unknown) => { if (current && alive) setError(projectionError(reason)); });
    });
    const generate = async () => {
        const source = unit();
        if (!source || link() || busy()) return;
        const generation = projectionWorkspaceGeneration();
        const lifetime = sourceLifetime;
        const valid = () => alive && sourceLifetime === lifetime && projectionWorkspaceGeneration() === generation
            && unit()?.id === source.id && !link();
        setBusy(true); setError(""); setCopied(false);
        try {
            const serverOrigin = projectionOrigin(origin().trim());
            setOrigin(serverOrigin);
            const frame = await renderProjectionFrame(source);
            if (!valid()) return;
            const response = await requestProjection({ kind: "create", unitId: source.id, contentKind: source.type, snapshot: frame.snapshot }, serverOrigin, PROJECTION_PROTOCOL_V2);
            if (!valid()) {
                queueProjectionUnlink(response.envelope);
                return;
            }
            patchProjection(source.id, projectionLinkFromResponse("source", source.id, response));
            props.retry(source.id);
        } catch (reason) { if (alive) setError(projectionError(reason)); }
        finally { if (alive) setBusy(false); }
    };
    const stop = () => {
        const saved = link();
        if (!saved) return;
        patchProjection(props.unitId, saved.stopped ? undefined : { ...saved, stopPending: true });
        props.retry(props.unitId);
    };
    const copy = async () => {
        const saved = link();
        if (!saved) return;
        const success = await api.copyTextToClipboard(JSON.stringify(saved.envelope));
        if (alive) { setCopied(success); if (!success) setError("复制失败，请重试。"); }
    };
    return <Show when={unit()} fallback={<p role="status">图块已关闭。</p>}>
        <p>将此图块的正式图像投射到另一台运行 Hook 的电脑，后续编辑会自动同步。</p>
        <Show when={origin()}><div class="qr-projection-address"><span>{legacy() ? "共享 Loom 服务" : "Loom 账号服务"}</span><strong>{origin()}</strong></div></Show>
        <Show when={!legacy()}>
            <p>两端在各自的 Loom 登录同一账号，由 Loom 自动发现设备并选择直连或加密中继。</p>
            <Show when={account()}>{(value) => <p role="status">本机 Loom 已登录 · {value().deviceName}</p>}</Show>
            <button type="button" class="hook-terminal-btn" disabled={busy() || accountLoading()} onClick={() => void refreshAccount()}>
                {accountLoading() ? "正在读取 Loom 登录状态…" : "刷新 Loom 登录状态"}</button>
        </Show>
        <Show when={legacy() && loopback()}><p class="qr-projection-warning">此旧版关联使用本机共享服务地址，只能用于本机验证。</p></Show>
        <Show when={link()} fallback={<button type="button" class="hook-terminal-btn hook-terminal-btn--active" disabled={busy() || accountLoading() || !account()} onClick={() => void generate()}>
            {busy() ? "准备图像与设备连接…" : "生成投射二维码"}</button>}>
            {(saved) => <>
                <p role="status">{saved().stopped ? "投射已停止" : saved().stopPending ? "本机已停止 · 等待通知远端" : projectionStatusLabel(projectionStatuses[props.unitId])}</p>
                <Show when={saved().role === "source" && !saved().linked && !saved().stopPending && !saved().stopped && remaining() > 0}>
                    <Show when={qr()}>{(src) => <img class="qr-projection-code" src={src()} alt="投射邀请二维码" />}</Show>
                    <p>邀请剩余 {remaining()} 秒。接收后，关联不受二维码有效期影响。</p>
                    <button type="button" class="hook-terminal-btn" onClick={() => void copy()}>{copied() ? "已复制邀请内容" : "复制邀请内容"}</button>
                </Show>
                <Show when={saved().role === "receiver"}><p>这是接收贴图。解除关联会保留当前图像及本地标注。</p></Show>
                <Show when={saved().stopReason ?? projectionStatuses[props.unitId]?.error}>{(code) => <p role="status" class="qr-projection-warning">{projectionError(code())}</p>}</Show>
                <div class="qr-projection-actions">
                    <button type="button" class="hook-terminal-btn" disabled={saved().stopped} onClick={() => props.retry(props.unitId)}>立即重试</button>
                    <button type="button" class="hook-terminal-btn hook-terminal-btn--danger" disabled={saved().stopPending} onClick={stop}>
                        {saved().stopped ? "移除已停止的关联" : saved().role === "source" ? "停止投射" : "解除关联"}</button>
                </div>
            </>}
        </Show>
        <Show when={error()}><p role="alert" class="qr-projection-warning">{error()}</p></Show>
        <button type="button" class="hook-terminal-btn" disabled={busy()} onClick={() => openProjectionReceiver()}>接收其他设备的投射</button>
    </Show>;
};
