import { Show } from "solid-js";
import { api } from "../services/api";
import { graphStore } from "../store/graphStore";
import { openProjection, openProjectionReceiver } from "../store/qrProjectionStore";
import { ProjectionIcon, type ProjectionDirection } from "./ProjectionToolbar";
import { ProjectionTargetToolbar } from "./ProjectionTargetToolbar";
import { ProjectionEditControls } from "./ProjectionEditControls";

export const ProjectionPropertyBar = (props: { unitId: string; mode: ProjectionDirection }) => {
    const unit = () => graphStore.units.find((unit) => unit.id === props.unitId);
    const link = () => unit()?.data.qrProjection;
    const source = () => link()?.sourceName || link()?.envelope.source.deviceId;
    const focus = (event: PointerEvent | MouseEvent) => { event.stopPropagation(); void api.focusOverlayWindow(); };
    const buttonClass = "hook-terminal-btn flex h-8 shrink-0 items-center justify-center gap-1 px-2";
    return <div class="hook-property-strip pointer-events-auto flex h-[40px] items-center gap-1.5 overflow-x-auto border-b px-1.5"
        role="group" aria-label={props.mode === "send" ? "投射二级设置" : "被投射二级设置"}
        onPointerDown={focus} onMouseDown={focus}>
        <ProjectionEditControls unitId={props.unitId} direction={props.mode} />
        <Show when={props.mode === "send"} fallback={<>
            <button type="button" class={buttonClass} aria-label="导入投射" title="导入投射" aria-haspopup="dialog"
                onClick={() => openProjectionReceiver("", "combined", props.unitId)}><ProjectionIcon kind="receive" /></button>
            <Show when={source()}>{(name) => <span class="flex min-w-0 items-center gap-1 text-xs" title={name()} aria-label={"投射来源：" + name()}>
                <ProjectionIcon kind="source" /><span class="truncate">{name()}</span>
            </span>}</Show>
        </>}>
            <button type="button" class={buttonClass} aria-label="生成投射二维码" title="生成二维码"
                onClick={() => openProjection(props.unitId, "qr")}><ProjectionIcon kind="qr" /></button>
            <Show when={props.unitId} keyed>{(id) => <ProjectionTargetToolbar unitId={id} />}</Show>
        </Show>
    </div>;
};
