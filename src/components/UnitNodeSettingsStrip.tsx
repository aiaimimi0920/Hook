import { createEffect, createSignal, Show } from "solid-js";
import type { ArtCapability } from "../services/protocol";
import type { NodeExecutionConfig, Unit } from "../types/unit";
import { deriveUnitExecutionConfig } from "../services/nodeExecutionConfig";
import { EXEC_manualTrigger, EXEC_paramDriven, EXEC_notifyDownstream, EXEC_upstreamDriven } from "../constants";
import { graphStore } from "../store/graphStore";
import { syncService } from "../services/syncService";
import { hideCollapsedUnitEndpoints } from "../store/unitChromeState";

export const UnitNodeSettingsStrip = (props: {
    unit: Unit; capability?: ArtCapability; execConfig?: NodeExecutionConfig; expanded: boolean;
    onParamChange: (id: string, value: unknown) => void;
}) => {
    const [open, setOpen] = createSignal(false);
    createEffect(() => setOpen(props.expanded));
    const config = () => deriveUnitExecutionConfig({ capability: props.capability, explicitConfig: props.execConfig ?? props.unit.data.executionConfig });
    const upstream = () => config().triggerMode.upstreamDriven && config().propagation.listenUpstream;
    const inherited = () => props.unit.data.stickerEditPropagation?.acceptUpstream ?? true;
    const toggleEndpoints = () => {
        graphStore.actions.updateUnitData(props.unit.id, { hideCollapsedEndpoints: !props.unit.data.hideCollapsedEndpoints });
        void syncService.performWorkflowSync();
    };
    const inherit = () => {
        graphStore.actions.updateUnitData(props.unit.id, { stickerEditPropagation: {
            ...props.unit.data.stickerEditPropagation, acceptUpstream: !inherited(),
        } });
        void syncService.performWorkflowSync();
    };
    return <div class="unit-node-drawer">
        <Show when={open()}><div class="unit-node-strip" data-tab-hit-region role="group" aria-label="节点属性">
            <span class="unit-node-name" title={props.capability?.label ?? "贴图"}>{props.capability?.label ?? "贴图"}</span>
            <button type="button" aria-label="显示/隐藏端点" aria-pressed={!props.unit.data.hideCollapsedEndpoints}
                title={props.unit.data.hideCollapsedEndpoints ? "收起时隐藏端点；点击改为显示" : "收起时显示端点；点击改为隐藏"} onClick={toggleEndpoints}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="4" width="10" height="14" rx="1"/><circle cx="3" cy="11" r="2"/><circle cx="21" cy="11" r="2"/><path d="m10 21 2 2 2-2"/>
                    <Show when={props.unit.data.hideCollapsedEndpoints}><path d="m3 3 18 18"/></Show>
                </svg>
            </button>
            <Show when={props.unit.type === "art"}>
                <button type="button" aria-label="上游变化自动执行" title="上游变化自动执行" aria-pressed={upstream()}
                    onClick={() => props.onParamChange(EXEC_upstreamDriven, !upstream())}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="11" height="11" rx="1.5"/><path d="m4.5 8 2 2 4-4M7 14v5h4"/><path class="unit-trigger-glyph" d="m19 10-6 7h4l-1 5 7-8h-5Z"/></svg>
                </button>
                <button type="button" aria-label="参数变化自动执行" title="参数变化自动执行" aria-pressed={config().triggerMode.paramDriven}
                    onClick={() => props.onParamChange(EXEC_paramDriven, !config().triggerMode.paramDriven)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3H2v16h8M6 6 4 14m7-8-2 8M4 8h8m-9 4h8"/><path class="unit-trigger-glyph" d="m19 5-6 9h4l-1 7 7-11h-5Z"/></svg>
                </button>
            </Show>
            <button type="button" aria-label="通知下游" title="通知下游：允许本节点更新触发下游执行" aria-pressed={config().propagation.notifyDownstream}
                onClick={() => props.onParamChange(EXEC_notifyDownstream, !config().propagation.notifyDownstream)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16h12l-2-3V8a4 4 0 0 0-8 0v5l-2 3ZM7 19a2 2 0 0 0 4 0M9 2v2m7 6h7m-3-3 3 3-3 3"/></svg>
            </button>
            <Show when={props.unit.type === "sticker"}>
                <button type="button" aria-label="接受上级贴图编辑传导" aria-pressed={inherited()} onClick={inherit}
                    title={props.unit.data.stickerEditPropagation?.locallyEdited ? "接受上级贴图编辑传导（已本地编辑，当前不会自动覆盖）" : "接受上级贴图编辑传导"}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 12 8-9 3 3-8 9-4 1 1-4Zm6-7 3 3M17 3v10m-3-3 3 3 3-3M3 19v3h18v-6"/></svg>
                </button>
            </Show>
            <Show when={props.unit.type === "art"}><button type="button" class="unit-node-run" title="执行一次" onClick={() => props.onParamChange(EXEC_manualTrigger, Date.now())}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path class="unit-trigger-glyph" d="m8 5 11 7-11 7Z"/></svg><span>执行</span>
            </button></Show>
        </div></Show>
        <Show when={open() || !hideCollapsedUnitEndpoints(props.unit.data.hideCollapsedEndpoints)}><button type="button" class="unit-node-expand" data-tab-hit-region aria-label={open() ? "收起节点属性" : "展开节点属性"} aria-expanded={open()} onClick={() => setOpen(!open())}>
            <svg viewBox="0 0 14 8" aria-hidden="true"><path d={open() ? "M0 8h14L7 0Z" : "M0 0h14L7 8Z"}/></svg>
        </button></Show>
    </div>;
};
