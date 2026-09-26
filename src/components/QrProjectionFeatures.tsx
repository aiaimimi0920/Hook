import { onCleanup, onMount, Show } from "solid-js";
import { unwrap } from "solid-js/store";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { graphStore } from "../store/graphStore";
import { openProjectionReceiver, projectionDialog, setProjectionStatuses } from "../store/qrProjectionStore";
import { isTauriRuntimeAvailable } from "../services/apiTransport";
import { requestProjection, unlinkProjection } from "../services/qrProjectionApi";
import { onProjectionUnitRemoved, projectionWorkspaceGeneration } from "../services/qrProjectionLifecycle";
import { patchProjection } from "../services/qrProjectionSession";
import { projectionContentSignature, renderProjectionFrame } from "../services/qrProjectionSnapshot";
import { createProjectionSync } from "../services/qrProjectionSync";
import { QrProjectionDialog } from "./QrProjectionDialog";
import { createProjectionCleanup } from "../services/qrProjectionCleanup";

export const QrProjectionFeatures = () => {
    const cleanup = createProjectionCleanup();
    const sync = createProjectionSync({
        units: () => unwrap(graphStore.units), generation: projectionWorkspaceGeneration,
        onUnitRemoved: onProjectionUnitRemoved,
        signature: projectionContentSignature, render: renderProjectionFrame,
        request: requestProjection, unlink: unlinkProjection, patch: patchProjection,
        status: (id, status) => setProjectionStatuses(id, status),
    });
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    onMount(() => {
        if (!isTauriRuntimeAvailable()) return;
        void listen("trigger-receive-projection", () => openProjectionReceiver()).then((stop) => {
            if (disposed) stop(); else unlisten = stop;
        }).catch(() => undefined);
    });
    onCleanup(() => { disposed = true; unlisten?.(); sync.dispose(); cleanup.dispose(); });
    return <Show when={projectionDialog()} keyed>{(target) => <QrProjectionDialog target={target} retry={sync.retry} />}</Show>;
};
