import { createEffect, createSignal, For, Show } from "solid-js";
import { stickerToolSettings } from "../store/uiStore";
import { ChevronDownCornerIcon } from "./stickerTopStripIcons";
import { toolbarButtonLeftBorderClass, toolbarCornerToggleClass, toolbarMenuClass, toolbarMenuItemClass } from "./stickerTopStripChrome";

export type ProjectionDirection = "send" | "receive";
export function createProjectionToolbarState(unitId: () => string) {
    const [direction, setDirection] = createSignal<ProjectionDirection>("send");
    const [tab, setTab] = createSignal<ProjectionDirection>();
    createEffect(() => {
        void [unitId(), stickerToolSettings.domain, stickerToolSettings.activeTool, stickerToolSettings.activeCanvasTool];
        setTab(undefined);
    });
    return { direction, setDirection, tab, setTab };
}
export type ProjectionIconKind = ProjectionDirection | "qr" | "link" | "devices" | "groups" | "friends" | "flow" | "flow-two" | "source";
export const ProjectionIcon = (props: { kind: ProjectionIconKind; class?: string }) => <svg
    class={props.class ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <Show when={props.kind === "send"}><path d="M4 12h15m-6-6 6 6-6 6M4 5v14" /></Show>
    <Show when={props.kind === "receive"}><path d="M20 12H5m6-6-6 6 6 6M20 5v14" /></Show>
    <Show when={props.kind === "flow"}><path d="M3 12h18m-5-5 5 5-5 5" /></Show>
    <Show when={props.kind === "flow-two"}><path d="M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4" /></Show>
    <Show when={props.kind === "qr"}><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3z" /><path stroke-width="3" d="M6 6h0m12 0h0M6 18h0" /><path d="M14 14h3v3h4m-7 0v4h3m4-7v-2m0 9v-1" /></Show>
    <Show when={props.kind === "link"}><path d="m9 15 6-6m-6 0 2-2a4 4 0 0 1 6 6l-2 2m0 0-2 2a4 4 0 0 1-6-6l2-2" /></Show>
    <Show when={props.kind === "devices" || props.kind === "source"}><path d="M3 4h18v12H3zM8 21h8m-4-5v5" /></Show>
    <Show when={props.kind === "groups"}><path d="M8 3h8v6H8zM2 16h8v6H2zM14 16h8v6h-8zM12 9v4M6 16v-3h12v3" /></Show>
    <Show when={props.kind === "friends"}><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 2 4v3" /></Show>
</svg>;

export const ProjectionToolbar = (props: {
    mode: ProjectionDirection; active: boolean; menuOpen: boolean;
    activate: () => void; toggleMenu: () => void; selectMode: (mode: ProjectionDirection) => void;
}) => <div class="relative h-[50px] w-[50px] shrink-0" onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" class={toolbarButtonLeftBorderClass} aria-label={props.mode === "send" ? "投射贴图" : "被投射贴图"}
        title={props.mode === "send" ? "投射" : "被投射"} aria-pressed={props.active}
        classList={{ "hook-toolbar-button--active": props.active, "hook-toolbar-idle": !props.active }} onClick={() => props.activate()}>
        <ProjectionIcon kind={props.mode} class="h-7 w-7" />
    </button>
    <button type="button" class={toolbarCornerToggleClass} aria-label="切换投射方向" title="投射 / 被投射"
        aria-expanded={props.menuOpen} aria-haspopup="menu" onClick={() => props.toggleMenu()}>
        <ChevronDownCornerIcon class="h-3 w-3" />
    </button>
    <Show when={props.menuOpen}><div class={toolbarMenuClass} style={{ left: "auto", right: "0" }} role="menu" aria-label="投射方向" data-top-strip-menu="true">
        <For each={["send", "receive"] as const}>{(mode) => <button type="button" role="menuitemradio"
            aria-checked={props.mode === mode} class={toolbarMenuItemClass} onClick={() => props.selectMode(mode)}>
            <ProjectionIcon kind={mode} /><span>{mode === "send" ? "投射" : "被投射"}</span>
        </button>}</For>
    </div></Show>
</div>;
