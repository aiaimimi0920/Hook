import { createEffect, onCleanup, onMount, Show, untrack } from "solid-js";
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
import { createDeliveryReceiver } from "../services/projectionDeliveryReceiver";
import { startupSessionReady } from "../services/appStartupState";
import { ProjectionDeliveryPrompt } from "./ProjectionDeliveryPrompt";
import { createManagedProjectionReceiver } from "../services/managedProjectionReceiver";
import { projectionEditing, registerProjectionEditRetry, synchronizeProjectionEditing } from "../services/projectionEditSession";

export const QrProjectionFeatures = () => {
    const cleanup = createProjectionCleanup();
    const sync = createProjectionSync({
        units: () => unwrap(graphStore.units), generation: projectionWorkspaceGeneration,
        onUnitRemoved: onProjectionUnitRemoved,
        signature: projectionContentSignature, render: renderProjectionFrame,
        request: requestProjection, unlink: unlinkProjection, patch: patchProjection,
        status: (id, status) => setProjectionStatuses(id, status),
        edit: synchronizeProjectionEditing,
    });
    const stopEditRetry = registerProjectionEditRetry(sync.retry);
    const stopEditRemoval = onProjectionUnitRemoved((id) => { void projectionEditing.remove(id).catch(() => undefined); });
    createEffect(() => {
        graphStore.units.map((unit) => unit.id);
        untrack(() => projectionEditing.refresh());
    });
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    createEffect(() => {
        if (!startupSessionReady() || !isTauriRuntimeAvailable()) return;
        // Polling reads must not make busy/settings changes dispose an in-flight receiver.
        const connection = untrack(createManagedProjectionReceiver);
        const receiver = untrack(createDeliveryReceiver);
        onCleanup(() => { connection.dispose(); receiver.dispose(); });
    });
    onMount(() => {
        if (!isTauriRuntimeAvailable()) return;
        void listen("trigger-receive-projection", () => openProjectionReceiver()).then((stop) => {
            if (disposed) stop(); else unlisten = stop;
        }).catch(() => undefined);
    });
    onCleanup(() => { disposed = true; unlisten?.(); sync.dispose(); cleanup.dispose(); stopEditRetry(); stopEditRemoval(); projectionEditing.dispose(); });
    return <><ProjectionDeliveryPrompt />
        <Show when={projectionDialog()} keyed>{(target) => <QrProjectionDialog target={target} retry={sync.retry} />}</Show>
    </>;
};
