import { onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { closeProjectionDialog, type ProjectionDialogTarget } from "../store/qrProjectionStore";
import { acceptsSurfaceRelayedKeydown } from "../services/surfaceHostKeydown";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { syncService } from "../services/syncService";
import { QrProjectionSender } from "./QrProjectionSender";
import { QrProjectionReceiver } from "./QrProjectionReceiver";
import { ProjectionBatchSender } from "./ProjectionBatchSender";
import "./QrProjectionDialog.css";

export const QrProjectionDialog = (props: { target: ProjectionDialogTarget; retry: (id: string) => void }) => {
    const importing = () => props.target.importKind === "combined";
    const compact = () => importing() || (!!props.target.unitId && props.target.shareAction === "qr");
    let dialog: HTMLElement | undefined;
    let closeButton: HTMLButtonElement | undefined;
    onMount(() => {
        let mounted = true;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeButton?.focus();
        // Unit DOM bounds are viewport CSS pixels, including live drag transforms.
        const anchor = compact() ? [...document.querySelectorAll<HTMLElement>("[data-unit-id]")]
            .find((element) => element.dataset.unitId === (props.target.anchorUnitId ?? props.target.unitId)) : undefined;
        const updateRect = () => {
            if (!mounted) return;
            if (compact() && dialog) {
                const source = anchor?.getBoundingClientRect();
                if (importing() && source) {
                    dialog.style.width = `${Math.max(1, Math.min(312, source.width, window.innerWidth - 16))}px`;
                    dialog.style.maxHeight = `${Math.max(1, Math.min(source.height, window.innerHeight - 16))}px`;
                }
                const size = dialog.getBoundingClientRect();
                const cx = source ? source.left + source.width / 2 : window.innerWidth / 2;
                const cy = source ? source.top + source.height / 2 : window.innerHeight / 2;
                dialog.style.left = `${Math.max(8, Math.min(cx - size.width / 2, window.innerWidth - size.width - 8))}px`;
                dialog.style.top = `${Math.max(8, Math.min(cy - size.height / 2, window.innerHeight - size.height - 8))}px`;
            }
            const rect = dialog?.getBoundingClientRect();
            if (!rect) return;
            addOrUpdateRect({ id: "qr-projection-dialog", name: "QR_PROJECTION_DIALOG", x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            void syncService.updateBackendRects();
        };
        const observer = new ResizeObserver(updateRect);
        if (dialog) observer.observe(dialog);
        if (anchor) observer.observe(anchor);
        const movement = new MutationObserver(updateRect);
        if (anchor) movement.observe(anchor, { attributes: true, attributeFilter: ["style", "class"] });
        window.addEventListener("scroll", updateRect, true);
        window.addEventListener("resize", updateRect);
        updateRect();
        const keydown = (event: KeyboardEvent) => {
            if (!acceptsSurfaceRelayedKeydown(event)) return;
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                closeProjectionDialog();
            } else if (event.key === "Tab") {
                const controls = [...(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary") ?? [])]
                    .filter((element) => element.getClientRects().length > 0);
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        };
        window.addEventListener("keydown", keydown, true);
        onCleanup(() => {
            mounted = false;
            observer.disconnect(); movement.disconnect();
            window.removeEventListener("scroll", updateRect, true);
            window.removeEventListener("resize", updateRect);
            window.removeEventListener("keydown", keydown, true);
            removeRect("qr-projection-dialog");
            void syncService.updateBackendRects();
            if (previousFocus?.isConnected) previousFocus.focus();
        });
    });
    return <Portal><div class="qr-projection-backdrop" classList={{ "qr-projection-backdrop--share": compact() }} role="presentation">
        <section ref={dialog} class="qr-projection-dialog" classList={{ "qr-projection-dialog--share": compact(), "qr-projection-dialog--import": importing() }} role="dialog"
            aria-modal={!compact()} aria-label={compact() ? importing() ? "导入投射" : "投射二维码" : undefined} aria-labelledby={compact() ? undefined : "qr-projection-title"}
            data-overlay-synthetic-target="direct" onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <header><Show when={!compact()}><h2 id="qr-projection-title">{props.target.unitId
                ? props.target.shareAction === "link" ? "投射链接" : props.target.shareAction === "targets" ? "选择投射设备" : "二维码投射"
                : props.target.importKind === "combined" ? "导入投射" : props.target.importKind === "link" ? "链接导入" : props.target.importKind === "qr" ? "二维码导入" : "接收二维码投射"}</h2></Show>
                <button ref={closeButton} type="button" class="hook-terminal-btn" aria-label="关闭投射面板" title="关闭" onClick={closeProjectionDialog}>{compact() ? "×" : "关闭"}</button></header>
            <div class="qr-projection-content">
                <Show when={props.target.unitId} fallback={<QrProjectionReceiver initialText={props.target.invitationText ?? ""} importKind={props.target.importKind} />}>
                    {(unitId) => <Show when={props.target.shareAction === "targets"} fallback={<QrProjectionSender unitId={unitId()} retry={props.retry} shareAction={props.target.shareAction} />}>
                        <ProjectionBatchSender unitId={unitId()} retry={props.retry} />
                    </Show>}
                </Show>
            </div>
            <Show when={!compact()}><footer>关闭面板后继续同步。接收端可独立调整位置、尺寸和本地标注。</footer></Show>
        </section>
    </div></Portal>;
};
