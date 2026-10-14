import { createUniqueId, onCleanup, onMount, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { api } from "../services/api";
import { acceptsSurfaceRelayedKeydown } from "../services/surfaceHostKeydown";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { syncTopStripBackendRects } from "../services/stickerTopStripSync";
import { claimProjectionPopup } from "../services/projectionPopup";

/** A viewport-clamped, native-clickable extension of the projection secondary bar. */
export const ProjectionTargetPopover = (props: {
    anchor: HTMLButtonElement; label: string; close: () => void; children: JSX.Element; compact?: boolean; list?: boolean;
    fixedTarget?: boolean; centerFrame?: { x: number; y: number; w: number; h: number };
}) => {
    const rectId = `projection-target-popover-${createUniqueId()}`;
    let panel!: HTMLDivElement;
    let frame = 0;
    let lastBounds = "";
    const focusTrigger = () => {
        const target = props.anchor.disabled ? props.anchor.parentElement?.querySelector<HTMLButtonElement>("button:not(:disabled)") : props.anchor;
        if (target?.isConnected) target.focus({ preventScroll: true });
    };
    const close = () => { focusTrigger(); props.close(); };
    const place = () => {
        const anchor = props.anchor.getBoundingClientRect();
        const width = Math.min(props.fixedTarget ? 320 : props.compact ? 72 : props.list ? 256 : 320, Math.max(1, window.innerWidth - 16));
        const below = window.innerHeight - anchor.bottom - 12;
        const above = anchor.top - 12;
        const up = below < 160 && above > below;
        panel.style.width = `${width}px`;
        panel.style.maxHeight = `${Math.max(40, Math.min(320, up ? above : below))}px`;
        panel.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
        panel.style.top = `${Math.max(8, up ? anchor.top - panel.getBoundingClientRect().height - 4 : anchor.bottom + 4)}px`;
        if (props.fixedTarget) {
            const height = Math.min(280, Math.max(1, window.innerHeight - 16));
            const center = props.centerFrame;
            panel.style.height = `${height}px`;
            panel.style.maxHeight = `${height}px`;
            panel.style.left = `${Math.max(8, Math.min(center ? center.x + (center.w - width) / 2 : anchor.left, window.innerWidth - width - 8))}px`;
            panel.style.top = `${Math.max(8, Math.min(center ? center.y + (center.h - height) / 2 : anchor.bottom + 4, window.innerHeight - height - 8))}px`;
        }
        const bounds = panel.getBoundingClientRect();
        const key = `${bounds.left},${bounds.top},${bounds.width},${bounds.height}`;
        if (key === lastBounds) return;
        lastBounds = key;
        addOrUpdateRect({ id: rectId, x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height, name: "STICKER_TOP_STRIP_MENU" });
        syncTopStripBackendRects();
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    onMount(() => {
        onCleanup(claimProjectionPopup(props.close));
        place();
        panel.focus({ preventScroll: true });
        const observer = new ResizeObserver(schedule);
        observer.observe(panel); observer.observe(props.anchor);
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && (panel.contains(event.target) || props.anchor.contains(event.target))) return;
            props.close();
        };
        const keydown = (event: KeyboardEvent) => {
            if (!acceptsSurfaceRelayedKeydown(event, { surfaceRelayed: true })) return;
            if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
            if (props.fixedTarget && event.key === "Tab") {
                const controls = [...panel.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
                const first = controls[0], last = controls[controls.length - 1];
                if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first?.focus(); }
            }
        };
        const focusout = (event: FocusEvent) => {
            if (event.target instanceof Node && !panel.contains(event.target) && !props.anchor.contains(event.target)) props.close();
        };
        window.addEventListener("pointerdown", outside, true);
        window.addEventListener("keydown", keydown, true);
        window.addEventListener("focusin", focusout);
        window.addEventListener("resize", schedule);
        window.addEventListener("scroll", schedule, true);
        onCleanup(() => {
            observer.disconnect(); cancelAnimationFrame(frame);
            window.removeEventListener("pointerdown", outside, true);
            window.removeEventListener("keydown", keydown, true);
            window.removeEventListener("focusin", focusout);
            window.removeEventListener("resize", schedule);
            window.removeEventListener("scroll", schedule, true);
            if (panel.contains(document.activeElement)) focusTrigger();
            removeRect(rectId); syncTopStripBackendRects();
        });
    });
    const focus = (event: MouseEvent | PointerEvent) => { event.stopPropagation(); void api.focusOverlayWindow(); };
    return <Portal><div ref={(el) => { panel = el; }} role="dialog" aria-label={props.label} tabIndex={-1}
        data-top-strip-menu="true" data-top-strip-property-popup="true"
        class={`otter-toolbar-menu pointer-events-auto fixed z-[1305] overscroll-contain text-xs ${props.list ? "flex flex-col overflow-hidden py-1" : "overflow-y-auto"} ${props.compact ? "py-1" : props.list ? "" : "p-2"} ${props.fixedTarget ? "projection-target-dialog" : ""}`}
        onPointerDown={focus} onMouseDown={focus} onPointerMove={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}>
        {!props.compact && !props.list && <button type="button" class="otter-terminal-btn float-right h-6 w-6" aria-label="关闭投射下拉菜单" onClick={close}>×</button>}
        {props.children}
    </div></Portal>;
};
