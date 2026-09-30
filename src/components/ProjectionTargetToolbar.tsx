import { createSignal, For, Show } from "solid-js";
import { useProjectionTargetControls } from "../hooks/useProjectionTargetControls";
import { ProjectionIcon } from "./ProjectionToolbar";
import { ProjectionTargetControlList } from "./ProjectionTargetControlList";
import { ProjectionTargetPopover } from "./ProjectionTargetPopover";
import { OverlayMenuScrollArea } from "./OverlayMenuScrollArea";
import { ChevronDownCornerIcon } from "./stickerTopStripIcons";

type List = "devices" | "groups" | "friends";
const targetLabels = { devices: "设备", groups: "设备组", friends: "用户" };
export const ProjectionTargetToolbar = (props: { unitId: string }) => {
    const controls = useProjectionTargetControls(props);
    const [popup, setPopup] = createSignal<{ kind: List; anchor: HTMLButtonElement }>();
    const toggle = (kind: List, anchor: HTMLButtonElement) => setPopup((current) => current?.kind === kind ? undefined : { kind, anchor });
    return <>
        <For each={["devices", "groups", "friends"] as const}>{(kind) => <button type="button"
            class="hook-terminal-btn flex h-8 shrink-0 items-center justify-center gap-1 px-2"
            aria-label={`选择投射${targetLabels[kind]}`} title={targetLabels[kind]}
            aria-haspopup="dialog" aria-expanded={popup()?.kind === kind} onClick={(event) => toggle(kind, event.currentTarget)}>
            <ProjectionIcon kind={kind} /><ChevronDownCornerIcon class={`h-3 w-3 transition-transform ${popup()?.kind === kind ? "rotate-180" : ""}`} />
        </button>}</For>
        <Show when={popup()} keyed>{(menu) => <ProjectionTargetPopover anchor={menu.anchor}
            label={`投射${targetLabels[menu.kind]}多选`} list close={() => setPopup(undefined)}>
            <div class="flex shrink-0 items-center justify-between gap-2 px-2 pb-1 text-[10px] opacity-70">
                <span>{targetLabels[menu.kind]} ID</span>
                <div class="flex items-center gap-2">
                    <Show when={menu.kind !== "friends"}><button type="button" class="hook-terminal-btn h-6 w-6"
                        aria-label="刷新可接收设备" title="刷新可接收设备" disabled={controls.busy()} onClick={() => void controls.refresh()}>↻</button></Show>
                    <span title="开启或取消投射">投射</span>
                    <span title="… 处理中；✓ 成功；! 失败，悬停查看详情">状态</span>
                </div>
            </div>
            <OverlayMenuScrollArea label="投射目标滚动条">
                <Show when={menu.kind !== "friends"} fallback={<p class="px-2 py-2" role="status">用户投射尚未开放。</p>}>
                    <ProjectionTargetControlList rows={controls.rows(menu.kind as "devices" | "groups")} busy={controls.busy()}
                        empty={controls.busy() ? "正在读取当前 Loom…" : menu.kind === "groups" ? "暂无设备组，请在 Loom 中配置。" : "暂无可投射设备。"} />
                    <Show when={controls.error()}><p class="mt-2 break-words px-2" role="alert">{controls.error()}</p></Show>
                </Show>
            </OverlayMenuScrollArea>
        </ProjectionTargetPopover>}</Show>
    </>;
};
