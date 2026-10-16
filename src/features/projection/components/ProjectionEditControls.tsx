import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { graphStore } from "../../workspace/state/graphStore";
import { openProjection, projectionStatuses } from "../state/qrProjectionStore";
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
    const [issueAnchor, setIssueAnchor] = createSignal<HTMLButtonElement>();
    const [busy, setBusy] = createSignal(false);
    const [failure, setFailure] = createSignal("");
    let alive = true;
    onCleanup(() => { alive = false; });
    createEffect(() => {
        const id = props.unitId;
        let current = true;
        setFailure(""); setIssueAnchor(undefined);
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
            <For each={["one_way", "two_way"] as const}>{(value) => <button type="button"
                aria-label={value === "two_way" ? "双向修改" : "单向修改"} aria-pressed={mode() === value}
                title={!source() ? `${label()}（由投射端设置）` : !supported() ? "当前投射不支持共享标注" : value === "two_way" ? "双向修改" : "单向修改"}
                disabled={!source() || busy() || !!status()?.pending || !supported()} aria-busy={busy() || !!status()?.pending}
                onClick={() => { if (value !== mode()) { const id = props.unitId; void run(() => setProjectionEditMode(id, value)); } }}>
                <span style={{ transform: props.direction === "receive" && value === "one_way" ? "scaleX(-1)" : undefined }}>
                    <ProjectionIcon kind={value === "two_way" ? "flow-two" : "flow"} />
                </span>
            </button>}</For>
        <Show when={status()?.conflicts || error()}>
            <button type="button" class="otter-terminal-btn h-8 w-9 shrink-0" aria-label="编辑需要处理" title="编辑需要处理"
                aria-haspopup="dialog" aria-expanded={!!issueAnchor()} onClick={(event) => { setIssueAnchor(issueAnchor() ? undefined : event.currentTarget); }}>!</button>
        </Show>
        <Show when={issueAnchor()}>{(button) => <ProjectionTargetPopover anchor={button()} label="投射编辑问题" close={() => setIssueAnchor(undefined)}>
            <Show when={error()}><p class="my-2 break-words" role="alert">{error()}</p></Show>
            <Show when={status()?.conflicts}>
                <p class="my-2">本地修改仍在图块中。采用远端版本会替换这些冲突修改。</p>
                <div class="flex flex-wrap gap-2">
                    <button type="button" class="otter-terminal-btn px-2 py-1" disabled={busy() || status()?.pending || (!source() && mode() !== "two_way")}
                        onClick={() => { const id = props.unitId; void run(() => resolveProjectionEditConflict(id, true)); }}>保留本地修改并提交</button>
                    <button type="button" class="otter-terminal-btn px-2 py-1" disabled={busy() || status()?.pending}
                        onClick={() => { const id = props.unitId; void run(() => resolveProjectionEditConflict(id, false)); }}>采用远端版本</button>
                </div>
            </Show>
            <button type="button" class="otter-terminal-btn mt-2 px-2 py-1" onClick={() => { setIssueAnchor(undefined); openProjection(props.unitId, source() ? "targets" : undefined); }}>管理投射关联</button>
        </ProjectionTargetPopover>}</Show>
    </>;
};
