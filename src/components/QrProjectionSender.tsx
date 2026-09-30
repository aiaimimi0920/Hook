import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { graphStore } from "../store/graphStore";
import { openProjection, openProjectionReceiver, projectionStatuses, projectionStatusLabel, type ProjectionShareAction } from "../store/qrProjectionStore";
import { projectionInvitationLink } from "../services/projectionInvitationLink";
import { api } from "../services/api";
import { projectionAccountContext, projectionCode, projectionContext, requestProjection } from "../services/qrProjectionApi";
import type { ProjectionAccountContext, ProjectionProtocol } from "../types/qrProjection";
import { queueProjectionUnlink } from "../services/qrProjectionCleanup";
import { onProjectionUnitRemoved, projectionWorkspaceGeneration } from "../services/qrProjectionLifecycle";
import { isProjectionLoopback, projectionError, projectionOrigin, PROJECTION_PROTOCOL, PROJECTION_PROTOCOL_V2 } from "../services/qrProjectionProtocol";
import { patchProjection, projectionLinkFromResponse } from "../services/qrProjectionSession";
import { renderProjectionFrame } from "../services/qrProjectionSnapshot";
import { projectionEditing } from "../services/projectionEditSession";

export const QrProjectionSender = (props: { unitId: string; retry: (id: string) => void; shareAction?: ProjectionShareAction }) => {
    const unit = () => graphStore.units.find((item) => item.id === props.unitId);
    const link = () => {
        const saved = unit()?.data.qrProjection;
        return saved?.localUnitId === props.unitId && (saved.role === "receiver" || saved.envelope.source.unitId === props.unitId) ? saved : undefined;
    };
    const [origin, setOrigin] = createSignal("");
    const [account, setAccount] = createSignal<ProjectionAccountContext>();
    const [accountLoading, setAccountLoading] = createSignal(false);
    const [selectedProtocol, setSelectedProtocol] = createSignal<ProjectionProtocol>(PROJECTION_PROTOCOL);
    const protocol = () => link()?.envelope.protocol ?? selectedProtocol();
    const shared = () => protocol() === PROJECTION_PROTOCOL;
    const [qr, setQr] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const [copied, setCopied] = createSignal(false);
    const [now, setNow] = createSignal(Date.now());
    let alive = true;
    let sourceLifetime = 0;
    let connectionLookup = 0;
    createEffect(() => {
        const unitId = props.unitId;
        sourceLifetime += 1;
        onCleanup(onProjectionUnitRemoved((id) => { if (id === unitId) sourceLifetime += 1; }));
    });
    const remaining = () => Math.max(0, Math.ceil(((link()?.envelope.expiresAtMs ?? 0) - now()) / 1000));
    const loopback = () => { try { return isProjectionLoopback(projectionOrigin(origin())); } catch { return false; } };
    const refreshConnection = async () => {
        const lookup = ++connectionLookup;
        const requestedProtocol = protocol();
        const current = () => alive && lookup === connectionLookup && protocol() === requestedProtocol;
        setAccountLoading(true); setError("");
        try {
            if (requestedProtocol === PROJECTION_PROTOCOL) {
                const value = await projectionContext();
                if (current() && !link()) setOrigin(value);
            } else {
                const value = await projectionAccountContext();
                if (current()) { setAccount(value); if (!link()) setOrigin(value.origin); }
            }
        } catch (reason) { if (current()) { setAccount(undefined); setError(projectionError(reason)); } }
        finally { if (current()) setAccountLoading(false); }
    };
    const selectProtocol = (value: ProjectionProtocol) => {
        if (busy() || link() || value === selectedProtocol()) return;
        setSelectedProtocol(value); setOrigin(""); setAccount(undefined);
        void refreshConnection();
    };
    const editSharedOrigin = (value: string) => {
        // A late manifest lookup must not overwrite the address the user chose.
        connectionLookup += 1;
        setAccountLoading(false); setError(""); setOrigin(value);
    };
    onMount(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        onCleanup(() => clearInterval(timer));
        void (async () => {
            if (!shared() || !link()) await refreshConnection();
            if (alive && (props.shareAction === "qr" || props.shareAction === "link") && origin()) await generate();
        })();
    });
    onCleanup(() => { alive = false; });
    createEffect(() => {
        const saved = link();
        setQr("");
        if (!saved) return;
        setSelectedProtocol(saved.envelope.protocol);
        setOrigin(saved.offlineTransport?.origin ?? saved.envelope.serverOrigin);
        if (props.shareAction === "link" || saved.offlineTransport || saved.role !== "source" || saved.stopped || saved.stopPending || saved.linked) return;
        let current = true;
        onCleanup(() => { current = false; });
        void projectionCode(saved.envelope).then((value) => { if (current && alive) setQr(value); })
            .catch((reason: unknown) => { if (current && alive) setError(projectionError(reason)); });
    });
    const generate = async () => {
        const source = unit();
        if (!source || link() || busy() || accountLoading() || (!shared() && !account())) return;
        const requestedProtocol = protocol();
        const generation = projectionWorkspaceGeneration();
        const lifetime = sourceLifetime;
        const valid = () => alive && sourceLifetime === lifetime && projectionWorkspaceGeneration() === generation
            && unit()?.id === source.id && !link();
        setBusy(true); setError(""); setCopied(false);
        try {
            const serverOrigin = projectionOrigin(origin().trim());
            setOrigin(serverOrigin);
            const frame = await projectionEditing.sendFrame(source.id, () => renderProjectionFrame(source), { origin: serverOrigin, protocol: requestedProtocol });
            if (!valid()) return;
            const operation = { kind: "create" as const, unitId: source.id, contentKind: source.type, snapshot: frame.snapshot };
            const response = await requestProjection(operation, serverOrigin, requestedProtocol);
            if (!valid()) {
                queueProjectionUnlink(response.envelope, ...(response.offlineTransport ? [response.offlineTransport] as const : [] as const));
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
        const success = await api.copyTextToClipboard(props.shareAction ? projectionInvitationLink(saved.envelope) : JSON.stringify(saved.envelope));
        if (alive) { setCopied(success); if (!success) setError("复制失败，请重试。"); }
    };
    return <Show when={unit()} fallback={<p role="status">图块已关闭。</p>}>
        <Show when={props.shareAction === "qr"} fallback={<>
        <Show when={!props.shareAction}><p>将此图块的正式图像投射到另一台运行 Hook 的电脑，后续编辑会自动同步。</p></Show>
        <Show when={!link() && !props.shareAction}>
            <div class="qr-projection-actions" role="group" aria-label="投射连接方式">
                <button type="button" class="hook-terminal-btn" aria-pressed={shared()} disabled={busy()}
                    onClick={() => selectProtocol(PROJECTION_PROTOCOL)}>共享 Loom（无需账号）</button>
                <button type="button" class="hook-terminal-btn" aria-pressed={!shared()} disabled={busy()}
                    onClick={() => selectProtocol(PROJECTION_PROTOCOL_V2)}>Loom 账号联网</button>
            </div>
        </Show>
        <Show when={shared() && !props.shareAction}>
            <p>连接当前 Loom 并完成设备配对，无需官方账号。设备列表也包含已配置互信的其他 Loom 的接收设备。</p>
            <Show when={!link()}><label class="qr-projection-field">共享 Loom 地址
                <input value={origin()} maxLength={256} disabled={busy()} spellcheck={false} placeholder="https://loom.example.com"
                    onInput={(event) => editSharedOrigin(event.currentTarget.value)} />
            </label></Show>
        </Show>
        <Show when={origin() && (!shared() || link())}><div class="qr-projection-address"><span>{shared() ? "共享 Loom 服务" : "Loom 账号服务"}</span><strong>{origin()}</strong></div></Show>
        <Show when={!shared()}>
            <p>当前账号模式要求两端在各自的本机 Loom 登录同一账号。官方会员中继尚未开放。</p>
            <Show when={account()}>{(value) => <p role="status">本机 Loom 已登录 · {value().deviceName}</p>}</Show>
            <button type="button" class="hook-terminal-btn" disabled={busy() || accountLoading()} onClick={() => void refreshConnection()}>
                {accountLoading() ? "正在读取 Loom 登录状态…" : "刷新 Loom 登录状态"}</button>
        </Show>
        <Show when={shared() && loopback()}><p class="qr-projection-warning">此地址指向本机 Loom。二维码分享需要双方可达的地址；跨 Loom 设备投送由各自的 Loom 转发。</p></Show>
        <Show when={shared() && !props.shareAction}><button type="button" class="hook-terminal-btn" disabled={busy()} onClick={() => openProjection(props.unitId, "targets")}>选择设备与设备组</button></Show>
        <Show when={link()} fallback={<button type="button" class="hook-terminal-btn hook-terminal-btn--active" disabled={busy() || accountLoading() || (shared() ? !origin().trim() : !account())} onClick={() => void generate()}>
            {busy() ? "准备图像与设备连接…" : props.shareAction === "link" ? "生成投射链接" : "生成投射二维码"}</button>}>
            {(saved) => <>
                <p role="status">{saved().stopped ? "投射已停止" : saved().stopPending ? "本机已停止 · 等待通知远端" : projectionStatusLabel(projectionStatuses[props.unitId])}</p>
                <Show when={!saved().offlineTransport && saved().role === "source" && !saved().linked && !saved().stopPending && !saved().stopped && remaining() > 0}>
                    <Show when={props.shareAction === "link"} fallback={<Show when={qr()}>{(src) => <img class="qr-projection-code" src={src()} alt="投射邀请二维码" />}</Show>}>
                        <label class="qr-projection-field">投射链接<textarea readOnly rows={5} value={projectionInvitationLink(saved().envelope)} aria-label="投射链接" /></label>
                    </Show>
                    <p>邀请剩余 {remaining()} 秒。接收后，关联不受二维码有效期影响。</p>
                    <button type="button" class="hook-terminal-btn" onClick={() => void copy()}>{copied() ? "已复制" : props.shareAction === "link" ? "复制链接" : "复制邀请内容"}</button>
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
        <Show when={!props.shareAction}><button type="button" class="hook-terminal-btn" disabled={busy()} onClick={() => openProjectionReceiver()}>接收其他设备的投射</button></Show>
        </>}>
            <Show when={link()} fallback={<Show when={!error()}><p role="status">正在生成二维码…</p></Show>}>
                {(saved) => <Show when={!saved().offlineTransport && saved().role === "source" && !saved().linked && !saved().stopPending && !saved().stopped && remaining() > 0}
                    fallback={<p role="status">{saved().stopped || saved().stopPending ? "投射已停止" : saved().linked ? "投射已连接" : saved().role === "receiver" ? "接收贴图无法生成邀请" : "邀请已失效"}</p>}>
                    <Show when={qr()} fallback={<Show when={!error()}><p role="status">正在生成二维码…</p></Show>}>
                        {(src) => <img class="qr-projection-code" src={src()} alt="投射邀请二维码" />}
                    </Show>
                    <input class="qr-projection-share-link" readOnly value={projectionInvitationLink(saved().envelope)}
                        aria-label={copied() ? "投射链接，已复制" : "投射链接"} title={copied() ? "已复制" : "点击复制链接"}
                        onFocus={(event) => event.currentTarget.select()}
                        onClick={(event) => { event.currentTarget.select(); void copy(); }} />
                </Show>}
            </Show>
            <Show when={error()}><p role="alert" class="qr-projection-warning">{error()}</p></Show>
        </Show>
    </Show>;
};
