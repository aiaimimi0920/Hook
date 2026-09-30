import { createSignal, onCleanup, onMount, untrack } from "solid-js";
import { graphStore } from "../store/graphStore";
import { projectionContext } from "../services/qrProjectionApi";
import { deliveryTargets, type DeliveryDirectory } from "../services/projectionDeliveryApi";
import { resolveProjectionSelection, type ProjectionSelection } from "../services/projectionTargetSelection";
import { sendProjectionBatch, type ProjectionBatchResult } from "../services/projectionBatchSend";
import { saveProjectionSenders } from "../services/qrProjectionSession";
import { onProjectionUnitRemoved, projectionWorkspaceGeneration } from "../services/qrProjectionLifecycle";
import { projectionError } from "../services/qrProjectionProtocol";
import { cancelPreparedCreates } from "../services/projectionCreateJournal";
import { queueProjectionUnlinks } from "../services/qrProjectionCleanup";

/** One owner across dropdowns: closing a list must not cancel an in-flight batch. */
export function useProjectionBatchSender(props: { unitId: string; retry?: (id: string) => void }) {
    const sourceId = untrack(() => props.unitId);
    const unit = () => graphStore.units.find((item) => item.id === sourceId);
    const [directory, setDirectory] = createSignal<DeliveryDirectory>({ targets: [], groups: [], status: "complete" });
    const [selection, setSelection] = createSignal<ProjectionSelection>({ devices: [], groups: [] });
    const [origin, setOrigin] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const [notice, setNotice] = createSignal("");
    const [results, setResults] = createSignal<ProjectionBatchResult[]>([]);
    const generation = projectionWorkspaceGeneration();
    let alive = true;
    onCleanup(onProjectionUnitRemoved((id) => { if (id === sourceId) alive = false; }));
    onCleanup(() => { alive = false; });
    const current = () => alive && props.unitId === sourceId && projectionWorkspaceGeneration() === generation ? unit() : undefined;
    const refresh = async (send = false) => {
        if (busy() || !current()) return;
        setBusy(true); setError(""); setNotice("");
        try {
            const nextOrigin = await projectionContext();
            if (!current()) return;
            if (origin() && origin() !== nextOrigin) {
                setSelection({ devices: [], groups: [] });
                if (send) { setOrigin(nextOrigin); setDirectory({ targets: [], status: "complete" }); throw new Error("projection_context_changed"); }
            }
            setOrigin(nextOrigin);
            const fresh = await deliveryTargets(nextOrigin);
            if (!current()) return;
            setDirectory(fresh);
            if (!send) return;
            const selected = resolveProjectionSelection(fresh, selection());
            setResults([]);
            if (selected.unavailable) setNotice(`当前有 ${selected.unavailable} 项设备或组成员不可用；仅发送可用目标。重叠组的不可用计数可能重复。`);
            if (!selected.targets.length) throw new Error("projection_target_unavailable");
            await sendProjectionBatch(nextOrigin, selected.targets, {
                current, save: (bindings) => { saveProjectionSenders(sourceId, bindings); props.retry?.(sourceId); },
                result: (result) => { if (current()) setResults((items) => [...items, result]); },
            });
        } catch (reason) { if (current()) setError(projectionError(reason)); }
        finally { if (alive) setBusy(false); }
    };
    onMount(() => { void refresh(); });
    const cancelPending = async () => {
        if (busy() || !current()) return;
        setBusy(true); setError("");
        try {
            const keep = new Set(unit()?.data.projectionSenders?.map((entry) => entry.link.envelope.projectionId));
            const pending = await cancelPreparedCreates(sourceId, keep);
            queueProjectionUnlinks(pending.map((entry) => ({ envelope: entry.envelope, ...(entry.target ? { offlineTransport: { origin: entry.origin } } : {}) })));
            if (current()) setNotice("未完成请求已取消；后台解除远端关联后可重新投射。");
        } catch (reason) { if (current()) setError(projectionError(reason)); }
        finally { if (alive) setBusy(false); }
    };
    const resolved = () => resolveProjectionSelection(directory(), selection());
    return { unit, directory, selection, setSelection, busy, error, notice, results, refresh, cancelPending, resolved };
}
