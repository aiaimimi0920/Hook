import { createSignal, For, onCleanup, Show } from "solid-js";
import { graphStore } from "../store/graphStore";
import { api } from "../services/api";
import { openProjection, openProjectionReceiver, projectionStatuses } from "../store/qrProjectionStore";
import { patchProjection } from "../services/qrProjectionSession";
import { projectionError } from "../services/qrProjectionProtocol";
import { ProjectionIcon, type ProjectionDirection } from "./ProjectionToolbar";
import { ProjectionEditControls } from "./ProjectionEditControls";
import { ProjectionTargetToolbar } from "./ProjectionTargetToolbar";
import { ProjectionSettingsIcon } from "./ProjectionSettingsIcons";
import "../styles/projection-settings.css";

export interface ProjectionSettingsFrame { x: number; y: number; w: number; h: number }

/** Closing the settings only disposes the UI; durable projection jobs belong to the sync service. */
export const ProjectionSettings = (props: { unitId: string; frame: ProjectionSettingsFrame }) => {
    const unit = () => graphStore.units.find((item) => item.id === props.unitId);
    const [mode, setMode] = createSignal<ProjectionDirection>(unit()?.data.qrProjection?.role === "receiver" ? "receive" : "send");
    return <section class="sticker-settings-panel projection-settings" aria-label="投射设置">
        <div class="projection-settings-tabs" role="tablist" aria-label="投射方向">
            <For each={["send", "receive"] as const}>{(direction) => <button type="button" role="tab"
                aria-label={direction === "send" ? "投射" : "被投射"} title={direction === "send" ? "投射" : "被投射"}
                aria-selected={mode() === direction} onClick={() => setMode(direction)}><ProjectionSettingsIcon kind={direction} /></button>}</For>
        </div>
        <div class="projection-settings-flow" role="group" aria-label="数据流通格式">
            <span class="projection-settings-label" title="数据流通格式"><ProjectionSettingsIcon kind="flow" /></span>
            <ProjectionEditControls unitId={props.unitId} direction={mode()} />
        </div>
        <Show when={mode() === "send"} fallback={<ProjectionReceiverActions unitId={props.unitId} />}>
            <div class="projection-settings-row" role="group" aria-label="导出投射">
                <span class="projection-settings-label" title="导出"><ProjectionSettingsIcon kind="export" /></span>
                <For each={["qr", "link"] as const}>{(kind) => <button type="button" aria-label={kind === "qr" ? "导出二维码" : "导出链接"}
                    title={kind === "qr" ? "导出二维码" : "导出链接"} disabled={unit()?.data.qrProjection?.role === "receiver"}
                    onClick={() => openProjection(props.unitId, kind)}><ProjectionIcon kind={kind} /></button>}</For>
            </div>
        </Show>
        {/* Keep the controller mounted across direction tabs so pending requests do not lose their owner. */}
        <div class="projection-settings-targets" style={{ display: mode() === "send" ? undefined : "none" }} role="group" aria-label="投射目标">
            <span class="projection-settings-label" title="投射目标"><ProjectionSettingsIcon kind="send" /></span>
            <ProjectionTargetToolbar unitId={props.unitId} frame={props.frame} />
        </div>
    </section>;
};

const ProjectionReceiverActions = (props: { unitId: string }) => {
    const unit = () => graphStore.units.find((item) => item.id === props.unitId);
    const link = () => unit()?.data.qrProjection?.role === "receiver" ? unit()!.data.qrProjection : undefined;
    const source = () => link()?.envelope.projectionId;
    const [copied, setCopied] = createSignal(false);
    const [error, setError] = createSignal("");
    let alive = true;
    onCleanup(() => { alive = false; });
    const copy = async () => {
        const value = source();
        if (!value) return;
        try {
            const success = await api.copyTextToClipboard(value);
            if (alive && source() === value) { setCopied(success); setError(success ? "" : "复制失败，请重试。"); }
        } catch (reason) { if (alive) setError(projectionError(reason)); }
    };
    const stop = () => {
        const saved = link();
        if (!saved || saved.stopPending) return;
        // Retain the source ID until the existing sync worker acknowledges remote unlink.
        patchProjection(props.unitId, { ...saved, stopped: false, stopReason: undefined, stopPending: true });
    };
    return <>
        <div class="projection-settings-row" role="group" aria-label="导入投射">
            <span class="projection-settings-label" title="导入"><ProjectionSettingsIcon kind="import" /></span>
            <For each={["qr", "link"] as const}>{(kind) => <button type="button" aria-label={kind === "qr" ? "导入二维码" : "导入链接"}
                title={kind === "qr" ? "导入二维码" : "导入链接"}
                onClick={() => openProjectionReceiver("", kind, props.unitId)}><ProjectionIcon kind={kind} /></button>}</For>
        </div>
        <div class="projection-settings-source" role="group" aria-label="投射来源">
            <span class="projection-settings-label" title="来源投射 ID"><ProjectionSettingsIcon kind="source" /></span>
            <code title={source() ?? "未关联"} aria-label={`来源投射 ID：${source() ?? "-"}`}>{source() ?? "-"}</code>
            <button type="button" aria-label="复制来源 ID" title={copied() ? "已复制" : "复制来源 ID"} disabled={!source()} onClick={() => void copy()}>
                <ProjectionSettingsIcon kind="copy" /></button>
            <button type="button" aria-label="退出被投射" title={link()?.stopPending ? "正在退出，等待远端确认" : "退出被投射"}
                disabled={!source() || link()?.stopPending} aria-busy={!!link()?.stopPending} onClick={stop}><ProjectionSettingsIcon kind="unlink" /></button>
        </div>
        <Show when={link()?.stopPending}><span class="projection-settings-notice" role="status">正在退出…</span></Show>
        <Show when={error() || (link() && projectionStatuses[props.unitId]?.error)}><span class="projection-settings-notice" role="alert">
            {error() || projectionError(projectionStatuses[props.unitId]!.error!)}
        </span></Show>
    </>;
};
