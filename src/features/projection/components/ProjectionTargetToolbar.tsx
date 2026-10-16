import { createSignal, For, Show } from "solid-js";
import { useProjectionTargetControls } from "../hooks/useProjectionTargetControls";
import { ProjectionIcon } from "./ProjectionToolbar";
import { ProjectionTargetControlList } from "./ProjectionTargetControlList";
import { ProjectionTargetPopover } from "./ProjectionTargetPopover";
import "../styles/projection-settings.css";

type List = "devices" | "groups" | "friends";
const targetLabels = { devices: "设备", groups: "设备组", friends: "用户" };
export const ProjectionTargetToolbar = (props: { unitId: string; frame?: { x: number; y: number; w: number; h: number } }) => {
    const controls = useProjectionTargetControls(props);
    const [popup, setPopup] = createSignal<{ kind: List; anchor: HTMLButtonElement }>();
    const toggle = (kind: List, anchor: HTMLButtonElement) => setPopup((current) => current?.kind === kind ? undefined : { kind, anchor });
    const [tab, setTab] = createSignal<List>("devices");
    const count = (kind: List) => kind === "friends" ? 0 : controls.rows(kind).filter((row) => row.checked && row.status.phase === "success").length;
    return <>
        <For each={["devices", "groups", "friends"] as const}>{(kind) => <button type="button"
            class="otter-terminal-btn flex h-8 shrink-0 items-center justify-center gap-1 px-2"
            aria-label={`选择投射${targetLabels[kind]}`} title={targetLabels[kind]}
            aria-haspopup="dialog" aria-expanded={popup()?.kind === kind} onClick={(event) => { setTab(kind); toggle(kind, event.currentTarget); }}>
            <ProjectionIcon kind={kind} /><span>{count(kind)}</span>
        </button>}</For>
        <Show when={popup()} keyed>{(menu) => <ProjectionTargetPopover anchor={menu.anchor}
            label="投射目标" list fixedTarget centerFrame={props.frame} close={() => setPopup(undefined)}>
            <div class="projection-target-tabs" role="tablist" aria-label="投射目标类型">
                <For each={["devices", "groups", "friends"] as const}>{(kind) => <button type="button" role="tab"
                    aria-selected={tab() === kind} onClick={() => setTab(kind)}><ProjectionIcon kind={kind} />{targetLabels[kind]}</button>}</For>
            </div>
            <div class="projection-target-list" role="tabpanel" aria-label={targetLabels[tab()]}>
                <Show when={tab() !== "friends"} fallback={<p class="px-2 py-2" role="status">用户投射尚未开放。</p>}>
                    <ProjectionTargetControlList rows={controls.rows(tab() as "devices" | "groups")} busy={controls.busy()}
                        empty={controls.busy() ? "正在读取当前 Loom…" : tab() === "groups" ? "暂无设备组，请在 Loom 中配置。" : "暂无可投射设备。"} />
                    <Show when={controls.error()}><p class="mt-2 break-words px-2" role="alert">{controls.error()}</p></Show>
                </Show>
            </div>
            <div class="projection-target-footer">
                <button type="button" aria-label="刷新可接收设备" title="刷新可接收设备" disabled={controls.busy()} onClick={() => void controls.refresh()}>↻</button>
                <button type="button" onClick={() => { menu.anchor.focus(); setPopup(undefined); }}>关闭</button>
            </div>
        </ProjectionTargetPopover>}</Show>
    </>;
};
