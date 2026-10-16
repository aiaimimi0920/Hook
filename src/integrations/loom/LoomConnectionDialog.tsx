import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { connectLoom, disconnectLoom, discoverLoom, prepareDiscoveredLoom, loomConnectionHistory, loomConnectionState, loomManualOrigin, probeLoom, type LoomInfo, type LoomTarget } from "./loomConnection";

export function LoomConnectionDialog(props: { close: () => void }) {
    const [tab, setTab] = createSignal<"discover" | "history" | "manual">("discover");
    const [targets, setTargets] = createSignal<LoomTarget[]>([]);
    const [selected, setSelected] = createSignal<LoomTarget>();
    const [info, setInfo] = createSignal<LoomInfo>();
    const [host, setHost] = createSignal("");
    const [port, setPort] = createSignal("");
    const [password, setPassword] = createSignal("");
    const [error, setError] = createSignal("");
    const [scanning, setScanning] = createSignal(false);
    const [probing, setProbing] = createSignal(false);
    const [submitting, setSubmitting] = createSignal(false);
    let alive = true;
    let selection = 0;
    const busy = () => submitting() || ["connecting", "waiting"].includes(loomConnectionState().phase);
    onCleanup(() => { alive = false; selection++; setPassword(""); });
    createEffect(() => { if (loomConnectionState().phase === "connected") props.close(); });
    const scan = async () => {
        if (scanning()) return;
        setScanning(true);
        try {
            const result = await discoverLoom();
            if (alive) {
                setTargets(result);
                if (tab() === "discover" && !busy() && selected() && !result.some((item) => item.origin === selected()?.origin)) {
                    selection++; setSelected(undefined); setInfo(undefined); setProbing(false); setPassword("");
                }
            }
        }
        catch (reason) { if (alive) { setTargets([]); setError(String(reason)); } }
        finally { if (alive) setScanning(false); }
    };
    onMount(() => {
        void scan();
        const timer = setInterval(() => { if (tab() === "discover" && !busy()) void scan(); }, 5000);
        onCleanup(() => clearInterval(timer));
    });
    const choose = async (target: LoomTarget) => {
        const current = ++selection;
        setSelected(target); setInfo(undefined); setPassword(""); setError(""); setProbing(true);
        try {
            const result = target.certificate ? (await prepareDiscoveredLoom(target)).info : await probeLoom(target.origin);
            if (!alive || selection !== current) return;
            if (target.loomId && result.loomId !== target.loomId) throw new Error("Loom 身份已变化，请核对目标地址");
            setInfo(result); setSelected({ ...target, name: result.name, loomId: result.loomId });
        } catch (reason) { if (alive && selection === current) setError(String(reason)); }
        finally { if (alive && selection === current) setProbing(false); }
    };
    const manual = () => {
        try { void choose({ origin: loomManualOrigin(host(), port()), name: "", loomId: "" }); }
        catch (reason) { setError(String(reason)); }
    };
    const connect = async () => {
        const target = selected(); const current = info();
        if (!target || !current || busy()) return;
        setSubmitting(true); setError("");
        const secret = password(); setPassword("");
        try { await connectLoom(target.origin, current.loomId, secret); }
        catch (reason) { if (alive) setError(String(reason)); }
        finally { if (alive) setSubmitting(false); }
    };
    const disconnect = async () => {
        setSubmitting(true);
        try { await disconnectLoom(); } catch (reason) { if (alive) setError(String(reason)); }
        finally { if (alive) setSubmitting(false); }
    };
    return <div class="loom-connection-dialog">
        <div class="loom-dialog-heading"><strong>Loom</strong><button type="button" aria-label="关闭 Loom 连接" onClick={() => props.close()}>×</button></div>
        <div class="projection-target-tabs" role="tablist" aria-label="Loom 目标来源">
            <For each={["discover", "history", "manual"] as const}>{(value) => <button type="button" role="tab" aria-selected={tab() === value}
                disabled={busy()} onClick={() => { setTab(value); selection++; setInfo(undefined); setSelected(undefined); setProbing(false); setPassword(""); setError(""); }}>{({ discover: "局域网", history: "历史", manual: "手动" })[value]}</button>}</For>
        </div>
        <div class="loom-dialog-body">
            <Show when={tab() === "manual"} fallback={<>
                <Show when={tab() === "discover"}><button type="button" class="loom-scan" disabled={scanning() || busy()} onClick={() => void scan()}>{scanning() ? "搜索中…" : "重新搜索"}</button></Show>
                <For each={tab() === "history" ? loomConnectionHistory() : targets()} fallback={<span class="loom-empty">{scanning() ? "搜索局域网 Loom…" : "暂无目标"}</span>}>{(target) =>
                    <button type="button" class="loom-target" aria-pressed={selected()?.origin === target.origin} disabled={busy()} onClick={() => void choose(target)}>
                        <strong>{target.name || "Loom"}</strong><span>{target.origin}</span>
                    </button>}</For>
            </>}>
                <form class="loom-manual" onSubmit={(event) => { event.preventDefault(); manual(); }}>
                    <input aria-label="Loom IP 或主机名" placeholder="IP / 主机名" value={host()} disabled={busy()} onInput={(event) => { setHost(event.currentTarget.value); setInfo(undefined); setProbing(false); selection++; }} />
                    <input aria-label="Loom 端口" placeholder="端口" inputMode="numeric" maxLength={5} value={port()} disabled={busy()} onInput={(event) => { setPort(event.currentTarget.value); setInfo(undefined); setProbing(false); selection++; }} />
                    <button type="submit" disabled={busy() || probing()}>查找</button>
                </form>
            </Show>
            <Show when={probing()}><span role="status">正在核对 Loom 身份…</span></Show>
            <Show when={info()}>{(current) => <div class="loom-selected"><strong>{current().name}</strong><code title={current().loomId}>{current().loomId}</code></div>}</Show>
        </div>
        <Show when={info()?.passwordRequired}><input type="password" aria-label="Loom 连接码" placeholder="连接码" autocomplete="off" maxLength={256} value={password()} disabled={busy()} onInput={(event) => setPassword(event.currentTarget.value)} /></Show>
        <Show when={error() || loomConnectionState().error}><div class="loom-error" role="alert">{error() || loomConnectionState().error}</div></Show>
        <div class="loom-dialog-footer"><span role="status">{loomConnectionState().phase === "waiting" ? "等待 Loom 批准…" : busy() ? "正在连接…" : ""}</span>
            <Show when={busy()} fallback={<button type="button" class="loom-primary" disabled={!info() || probing()} onClick={() => void connect()}>连接</button>}>
                <button type="button" disabled={submitting()} onClick={() => void disconnect()}>取消连接</button>
            </Show>
        </div>
    </div>;
}
