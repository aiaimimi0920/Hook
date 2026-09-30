import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { graphStore } from "../store/graphStore";
import { openProjection, projectionStatuses } from "../store/qrProjectionStore";
import { projectionEditing, projectionEditStatuses, resolveProjectionEditConflict, setProjectionEditMode } from "../services/projectionEditSession";
import { projectionError } from "../services/qrProjectionProtocol";
import { projectionAssociations } from "../services/projectionSenderBindings";
import { projectionWorkspaceGeneration } from "../services/qrProjectionLifecycle";
import { ProjectionIcon, type ProjectionDirection } from "./ProjectionToolbar";
import { ProjectionTargetPopover } from "./ProjectionTargetPopover";

/** Compact flow selection; exceptional edit failures retain their own native popup. */
export const ProjectionEditControls = (props: { unitId: string; direction: ProjectionDirection }) => {
    const unit = () => graphStore.units.find((unit) => unit.id === props.unitId);
    const status = () => projectionEditStatuses[props.unitId];
    const mode = () => status()?.mode ?? "one_way";
    const source = () => props.direction === "send" && unit()?.data.qrProjection?.role !== "receiver";
    const supported = () => !unit() || projectionAssociations(unit()!).every(({ link }) => link.stopped || link.envelope.protocol === "neuro.qr-projection.v1");
    const [anchor, setAnchor] = createSignal<HTMLButtonElement>();
    const [issueAnchor, setIssueAnchor] = createSignal<HTMLButtonElement>();
    const [busy, setBusy] = createSignal(false);
    const [failure, setFailure] = createSignal("");
    let alive = true;
    onCleanup(() => { alive = false; });
    createEffect(() => {
        const id = props.unitId;
        let current = true;
        setFailure(""); setAnchor(undefined); setIssueAnchor(undefined);
        void projectionEditing.inspect(id).catch((reason: unknown) => { if (current) setFailure(projectionError(reason)); });
        onCleanup(() => { current = false; });
    });
    const error = () => failure() || (status()?.error ? projectionError(status()!.error) : "")
        || (projectionStatuses[props.unitId]?.error ? projectionError(projectionStatuses[props.unitId]!.error) : "");
    const run = async (work: () => Promise<void>) => {
        if (busy()) return;
        const id = props.unitId; const generation = projectionWorkspaceGeneration();
        const current = () => alive && props.unitId === id && projectionWorkspaceGeneration() === generation;
        setBusy(true); setFailure("");
        try { await work(); }
        catch (reason) { if (current()) setFailure(projectionError(reason)); }
        finally { if (current()) setBusy(false); }
    };
    const label = () => `数据流向：${mode() === "two_way" ? "双向修改" : "单向修改"}`;
    return <>
        <Show when={source()} fallback={<span class="flex h-8 w-9 shrink-0 cursor-default items-center justify-center text-[var(--theme-text-muted)]"
            role="img" aria-label={label()} title={`${label()}（由投射端设置）`}>
            <ProjectionIcon kind={mode() === "two_way" ? "flow-two" : "flow"} />
        </span>}>
        <button type="button" class="hook-terminal-btn relative flex h-8 w-9 shrink-0 items-center justify-center"
            aria-label={label()} title={label()} aria-busy={busy() || !!status()?.pending}
            aria-haspopup="dialog" aria-expanded={!!anchor()} onClick={(event) => { setIssueAnchor(undefined); setAnchor(anchor() ? undefined : event.currentTarget); }}>
            <ProjectionIcon kind={mode() === "two_way" ? "flow-two" : "flow"} />
            <span aria-hidden="true" class="absolute bottom-0 right-0.5 text-[9px]">▾</span>
        </button>
        </Show>
        <Show when={source() && anchor()}>{(button) => <ProjectionTargetPopover compact anchor={button()} label="投射数据流向" close={() => setAnchor(undefined)}>
            <div role="group" aria-label="投射数据流向选项">
                <For each={["one_way", "two_way"] as const}>{(value) => <button type="button"
                    class="hook-toolbar-menu-item flex h-7 w-full items-center justify-center"
                    classList={{ "hook-toolbar-menu-item--active": mode() === value }} aria-pressed={mode() === value}
                    aria-label={value === "two_way" ? "双向修改" : "单向修改"}
                    title={!source() ? "由投射端设置" : !supported() ? "当前投射不支持共享标注" : value === "two_way" ? "双向修改" : "单向修改"}
                    disabled={!source() || busy() || !supported()} onClick={() => {
                        const id = props.unitId; setAnchor(undefined); void run(() => setProjectionEditMode(id, value));
                    }}>
                    <ProjectionIcon kind={value === "two_way" ? "flow-two" : "flow"} />
                </button>}</For>
            </div>
        </ProjectionTargetPopover>}</Show>
        <Show when={status()?.conflicts || error()}>
            <button type="button" class="hook-terminal-btn h-8 w-9 shrink-0" aria-label="编辑需要处理" title="编辑需要处理"
                aria-haspopup="dialog" aria-expanded={!!issueAnchor()} onClick={(event) => { setAnchor(undefined); setIssueAnchor(issueAnchor() ? undefined : event.currentTarget); }}>!</button>
        </Show>
        <Show when={issueAnchor()}>{(button) => <ProjectionTargetPopover anchor={button()} label="投射编辑问题" close={() => setIssueAnchor(undefined)}>
            <Show when={error()}><p class="my-2 break-words" role="alert">{error()}</p></Show>
            <Show when={status()?.conflicts}>
                <p class="my-2">本地修改仍在图块中。采用远端版本会替换这些冲突修改。</p>
                <div class="flex flex-wrap gap-2">
                    <button type="button" class="hook-terminal-btn px-2 py-1" disabled={busy() || status()?.pending || (!source() && mode() !== "two_way")}
                        onClick={() => { const id = props.unitId; void run(() => resolveProjectionEditConflict(id, true)); }}>保留本地修改并提交</button>
                    <button type="button" class="hook-terminal-btn px-2 py-1" disabled={busy() || status()?.pending}
                        onClick={() => { const id = props.unitId; void run(() => resolveProjectionEditConflict(id, false)); }}>采用远端版本</button>
                </div>
            </Show>
            <button type="button" class="hook-terminal-btn mt-2 px-2 py-1" onClick={() => { setIssueAnchor(undefined); openProjection(props.unitId, source() ? "targets" : undefined); }}>管理投射关联</button>
        </ProjectionTargetPopover>}</Show>
    </>;
};
