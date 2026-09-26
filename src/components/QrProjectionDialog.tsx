import { onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { closeProjectionDialog, type ProjectionDialogTarget } from "../store/qrProjectionStore";
import { acceptsSurfaceRelayedKeydown } from "../services/surfaceHostKeydown";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { syncService } from "../services/syncService";
import { QrProjectionSender } from "./QrProjectionSender";
import { QrProjectionReceiver } from "./QrProjectionReceiver";
import "./QrProjectionDialog.css";

export const QrProjectionDialog = (props: { target: ProjectionDialogTarget; retry: (id: string) => void }) => {
    let dialog: HTMLElement | undefined;
    let closeButton: HTMLButtonElement | undefined;
    onMount(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeButton?.focus();
        const updateRect = () => {
            const rect = dialog?.getBoundingClientRect();
            if (!rect) return;
            addOrUpdateRect({ id: "qr-projection-dialog", name: "QR_PROJECTION_DIALOG", x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            void syncService.updateBackendRects();
        };
        const observer = new ResizeObserver(updateRect);
        if (dialog) observer.observe(dialog);
        window.addEventListener("resize", updateRect);
        updateRect();
        const keydown = (event: KeyboardEvent) => {
            if (!acceptsSurfaceRelayedKeydown(event)) return;
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                closeProjectionDialog();
            } else if (event.key === "Tab") {
                const controls = [...(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)") ?? [])];
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        };
        window.addEventListener("keydown", keydown, true);
        onCleanup(() => {
            observer.disconnect();
            window.removeEventListener("resize", updateRect);
            window.removeEventListener("keydown", keydown, true);
            removeRect("qr-projection-dialog");
            void syncService.updateBackendRects();
            if (previousFocus?.isConnected) previousFocus.focus();
        });
    });
    return <Portal><div class="qr-projection-backdrop" role="presentation">
        <section ref={dialog} class="qr-projection-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-projection-title"
            data-overlay-synthetic-target="direct" onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <header><h2 id="qr-projection-title">{props.target.unitId ? "二维码投射" : "接收二维码投射"}</h2>
                <button ref={closeButton} type="button" class="hook-terminal-btn" aria-label="关闭投射面板" onClick={closeProjectionDialog}>关闭</button></header>
            <div class="qr-projection-content">
                <Show when={props.target.unitId} fallback={<QrProjectionReceiver initialText={props.target.invitationText ?? ""} />}>
                    {(unitId) => <QrProjectionSender unitId={unitId()} retry={props.retry} />}
                </Show>
            </div>
            <footer>关闭面板后继续同步。接收端可独立调整位置、尺寸和本地标注。</footer>
        </section>
    </div></Portal>;
};
