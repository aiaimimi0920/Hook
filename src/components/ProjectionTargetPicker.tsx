import { For, Show } from "solid-js";
import type { DeliveryDirectory } from "../services/projectionDeliveryApi";
import type { ProjectionSelection } from "../services/projectionTargetSelection";
import { ProjectionIcon } from "./ProjectionToolbar";

interface PickerProps {
    directory: DeliveryDirectory; disabled: boolean; selection: ProjectionSelection;
    change: (selection: ProjectionSelection) => void;
}
export const ProjectionTargetOptions = (props: PickerProps & { kind: keyof ProjectionSelection }) => {
    const toggle = (kind: keyof ProjectionSelection, id: string, checked: boolean) => props.change({
        ...props.selection, [kind]: checked ? [...new Set([...props.selection[kind], id])] : props.selection[kind].filter((value) => value !== id),
    });
    const rowClass = "hook-toolbar-menu-item flex min-h-8 items-center justify-between gap-3 px-2 py-1";
    const checkClass = "h-3.5 w-3.5 shrink-0 accent-[var(--theme-signal)]";
    return <div class="flex flex-col py-1">
        <Show when={props.kind === "devices"} fallback={<>
            <Show when={props.directory.groups?.length} fallback={<p role="status">暂无设备组，请在 Loom 中配置。</p>}>
                <For each={props.directory.groups ?? []}>{(group) => <label class={rowClass} title={`${group.name} · ${group.targetIds.length} 台设备`}>
                    <span class="min-w-0 truncate">{group.groupId}
                        <Show when={group.unavailableCount}> · {group.unavailableCount} 不可用</Show></span>
                    <input type="checkbox" class={checkClass} aria-label={`${group.groupId} 投射开关`}
                        disabled={props.disabled} checked={props.selection.groups.includes(group.groupId)}
                        onChange={(event) => toggle("groups", group.groupId, event.currentTarget.checked)} />
                </label>}</For>
            </Show>
        </>}>
            <Show when={props.directory.targets.length} fallback={<p role="status">暂无可投射设备。</p>}>
                <For each={props.directory.targets}>{(target) => <label class={rowClass}
                    title={`${target.deviceId} · ${target.name}${target.route === "offline_peer" ? ` · ${target.peerName}` : ""}`}>
                    <span class="min-w-0 truncate">{target.deviceId}{target.route === "offline_peer" ? ` · ${target.peerName}` : ""}</span>
                    <input type="checkbox" class={checkClass} aria-label={`${target.deviceId} 投射开关`}
                        disabled={props.disabled || (target.route === "offline_peer" && !target.deliveryAvailable)}
                        checked={props.selection.devices.includes(target.deviceId)}
                        onChange={(event) => toggle("devices", target.deviceId, event.currentTarget.checked)} />
                </label>}</For>
            </Show>
        </Show>
    </div>;
};

export const ProjectionTargetPicker = (props: PickerProps) => <section aria-label="投射目标选择" class="flex flex-col gap-2">
        <details open><summary class="flex cursor-pointer items-center gap-2" aria-label="设备多选">
            <ProjectionIcon kind="devices" /><span>{props.selection.devices.length} / {props.directory.targets.length}</span></summary>
            <div class="max-h-48 overflow-y-auto"><ProjectionTargetOptions {...props} kind="devices" /></div>
        </details>
        <details><summary class="flex cursor-pointer items-center gap-2" aria-label="设备组多选" title="设备组多选">
            <ProjectionIcon kind="groups" /><span>{props.selection.groups.length} / {props.directory.groups?.length ?? 0}</span></summary>
            <div class="max-h-48 overflow-y-auto"><ProjectionTargetOptions {...props} kind="groups" /></div>
        </details>
        <button type="button" class="hook-terminal-btn flex items-center gap-2" disabled aria-label="好友投射尚未开放" title="官方账号与好友服务尚未开放"><ProjectionIcon kind="friends" /><span>0</span></button>
        <Show when={props.directory.status !== "complete"}><p role="status">部分 Loom 目录暂不可用，当前仅显示已验证的设备。</p></Show>
    </section>;
