import { createEffect, createMemo, For, Show } from "solid-js";
import type { ProjectionTargetRow } from "../hooks/useProjectionTargetControls";

export const ProjectionTargetControlList = (props: { rows: ProjectionTargetRow[]; empty: string; busy: boolean }) => {
    const rows = createMemo(() => new Map(props.rows.map((row) => [row.key, row])));
    const symbols = { idle: "—", pending: "…", success: "✓", error: "!" };
    return <Show when={props.rows.length} fallback={<p class="px-2 py-2" role="status">{props.empty}</p>}>
        <div class="flex flex-col py-1"><For each={[...rows().keys()]}>{(key) => {
            const row = () => rows().get(key)!;
            let checkbox!: HTMLInputElement;
            createEffect(() => { checkbox.indeterminate = !!row().mixed; });
            return <div class="hook-toolbar-menu-item flex min-h-8 items-center gap-2 px-2 py-1" data-projection-target={row().id}>
                <label class="flex min-w-0 flex-1 items-center justify-between gap-3" title={row().title}>
                    <span class="min-w-0 truncate">{row().id}</span>
                    <input ref={checkbox} type="checkbox" class="h-3.5 w-3.5 shrink-0 accent-[var(--theme-signal)]"
                        aria-label={`${row().id} 投射开关`} checked={row().checked} aria-checked={row().mixed ? "mixed" : row().checked}
                        disabled={row().disabled} onChange={(event) => row().change(event.currentTarget.checked)} />
                </label>
                <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center text-xs" role="status"
                    data-phase={row().status.phase} aria-label={`${row().id}：${row().status.message}`} title={row().status.message}
                    classList={{ "text-[var(--theme-success)]": row().status.phase === "success",
                        "text-[var(--theme-danger)]": row().status.phase === "error",
                        "text-[var(--theme-signal)]": row().status.phase === "pending" }}>
                    <Show when={row().retry} fallback={symbols[row().status.phase]}>
                        <button type="button" class="h-5 w-5" aria-label={`重试 ${row().id}`}
                            disabled={props.busy} title={`重试：${row().status.message}`} onClick={() => row().retry?.()}>!</button>
                    </Show>
                </span>
            </div>;
        }}</For></div>
    </Show>;
};
