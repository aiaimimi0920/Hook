import { For, Show } from "solid-js";
import { projectionStatuses, projectionStatusLabel } from "../store/qrProjectionStore";
import { projectionBindingKey, projectionBindingStatusKey } from "../services/projectionSenderBindings";
import { patchProjection } from "../services/qrProjectionSession";
import { projectionError } from "../services/qrProjectionProtocol";
import { ProjectionTargetPicker } from "./ProjectionTargetPicker";
import { ProjectionIcon } from "./ProjectionToolbar";
import { useProjectionBatchSender } from "../hooks/useProjectionBatchSender";

export const ProjectionBatchSender = (props: { unitId: string; retry: (id: string) => void }) => {
    const { unit, directory, selection, setSelection, busy, error, notice, results, refresh, cancelPending, resolved } = useProjectionBatchSender(props);
    return <Show when={unit()} fallback={<p role="status">图块已关闭。</p>}>
        <p>选择目标后投射。设备、设备组和接收规则由当前 Loom 管理。</p>
        <button type="button" class="hook-terminal-btn" disabled={busy()} onClick={() => void refresh()}>刷新可接收设备</button>
        <ProjectionTargetPicker directory={directory()} disabled={busy()} selection={selection()} change={setSelection} />
        <button type="button" class="hook-terminal-btn hook-terminal-btn--active flex items-center gap-2" aria-label={`投射到 ${resolved().targets.length} 台设备`}
            disabled={busy() || !resolved().targets.length || unit()?.data.qrProjection?.role === "receiver"} onClick={() => void refresh(true)}>
            <ProjectionIcon kind="send" /><span>{busy() ? "…" : resolved().targets.length}</span>
        </button>
        <Show when={notice()}><p role="status">{notice()}</p></Show>
        <Show when={error()}><p role="alert">{error()}</p></Show>
        <button type="button" class="hook-terminal-btn" disabled={busy()} onClick={() => void cancelPending()}>取消未完成投射</button>
        <For each={results()}>{(result) => <p role="status">{result.target.name} · {result.error ? projectionError(result.error) : result.created ? "邀请已发送，等待接收回执" : "已有投射关联，未重复创建"}</p>}</For>
        <For each={unit()?.data.projectionSenders ?? []}>{(binding) => {
            const statusKey = () => projectionBindingStatusKey(props.unitId, projectionBindingKey(binding.link));
            return <section class="my-2 border-t py-2" aria-label={`投射关联 ${binding.target.name}`}>
                <p>{binding.target.name} · {binding.link.stopped ? "投射已停止" : binding.link.stopPending ? "等待通知远端停止" : projectionStatusLabel(projectionStatuses[statusKey()])}</p>
                <Show when={binding.link.stopReason ?? projectionStatuses[statusKey()]?.error}>{(code) => <p role="status">{projectionError(code())}</p>}</Show>
                <button type="button" class="hook-terminal-btn" disabled={busy() || binding.link.stopped} onClick={() => props.retry(statusKey())}>重试同步</button>
                <button type="button" class="hook-terminal-btn hook-terminal-btn--danger" disabled={busy() || binding.link.stopPending}
                    onClick={() => { patchProjection(props.unitId, binding.link.stopped ? undefined : { ...binding.link, stopPending: true }, undefined, projectionBindingKey(binding.link)); props.retry(statusKey()); }}>
                    {binding.link.stopped ? "移除关联" : "停止投射"}</button>
            </section>;
        }}</For>
    </Show>;
};
