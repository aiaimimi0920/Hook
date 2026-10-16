import { Show, createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import { api } from "../../../platform/tauri/api";
import { hitBezierHandle } from "../services/stickerBezierGeometry";
import { deleteBezierAnchor } from "../services/stickerBezierSubdivision";
import { syncTopStripBackendRects } from "../services/stickerTopStripSync";
import { acceptsSurfaceRelayedKeydown } from "../../surfaces/services/surfaceHostKeydown";
import { addOrUpdateRect, removeRect } from "../../../platform/desktop/uiRegistry";
import type { StickerAnnotation, StickerLineAnnotation, StickerPoint } from "../types/stickerEditing";

interface NodeMenuOptions {
    unitId: Accessor<string>;
    enabled: Accessor<boolean>;
    selected: Accessor<StickerAnnotation | undefined>;
    elements: Accessor<StickerAnnotation[]>;
    toLocalPoint: (event: PointerEvent) => StickerPoint;
    commit: (elements: StickerAnnotation[]) => Promise<void>;
}

/** Owns transient node-menu state, native hit rectangles, and dismissal listeners. */
export const createBezierNodeMenu = (options: NodeMenuOptions) => {
    const [menu, setMenu] = createSignal<{ annotation: StickerLineAnnotation; index: number; x: number; y: number } | null>(null);
    let root: HTMLDivElement | undefined;
    const close = () => setMenu(null);
    const onContextMenu = (event: MouseEvent) => {
        const annotation = options.selected();
        if (!options.enabled() || annotation?.type !== "bezier") return;
        const handle = hitBezierHandle(annotation.points, options.toLocalPoint(event as PointerEvent));
        const index = handle === "start" ? 0 : handle === "end" ? annotation.points.length - 1
            : handle?.startsWith("node:") ? Number(handle.slice(5)) : -1;
        if (index < 0) return;
        event.preventDefault();
        event.stopPropagation();
        setMenu({ annotation, index, x: event.clientX, y: event.clientY });
        void api.focusOverlayWindow().catch(() => {});
    };

    const removeNode = async () => {
        const current = menu();
        if (!current || !options.enabled() || options.selected() !== current.annotation) { close(); return; }
        const points = deleteBezierAnchor(current.annotation.points, current.index);
        close();
        if (points.length === current.annotation.points.length) return;
        await options.commit(options.elements().map((item) => item.id === current.annotation.id ? { ...item, points } : item));
    };

    createEffect(() => {
        const current = menu();
        if (!current) return;
        // A history/selection/tool change invalidates the index captured by this menu.
        if (!options.enabled() || options.selected() !== current.annotation) close();
    });
    createEffect(() => {
        const initialMenu = menu();
        if (!initialMenu) return;
        const rectId = `sticker-bezier-node-menu-${options.unitId()}`;
        const previousFocus = document.activeElement;
        const position = () => {
            if (!root) return;
            const bounds = root.getBoundingClientRect();
            root.style.left = `${Math.max(4, Math.min(initialMenu.x, window.innerWidth - bounds.width - 4))}px`;
            root.style.top = `${Math.max(4, Math.min(initialMenu.y, window.innerHeight - bounds.height - 4))}px`;
            const placed = root.getBoundingClientRect();
            // Native overlay routing recognizes this shared menu role by name.
            addOrUpdateRect({ id: rectId, x: placed.left, y: placed.top, width: placed.width, height: placed.height, name: "STICKER_CONTEXT_MENU_ROOT" });
            syncTopStripBackendRects();
            (root.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? root).focus({ preventScroll: true });
        };
        const frame = requestAnimationFrame(position);
        const outside = (event: PointerEvent) => { if (!root?.contains(event.target as Node)) close(); };
        const keydown = (event: KeyboardEvent) => {
            if (!acceptsSurfaceRelayedKeydown(event)) return;
            if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
        };
        document.addEventListener("pointerdown", outside, true);
        window.addEventListener("keydown", keydown, true);
        window.addEventListener("resize", close);
        window.addEventListener("blur", close);
        onCleanup(() => {
            cancelAnimationFrame(frame);
            document.removeEventListener("pointerdown", outside, true);
            window.removeEventListener("keydown", keydown, true);
            window.removeEventListener("resize", close);
            window.removeEventListener("blur", close);
            removeRect(rectId);
            syncTopStripBackendRects();
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
        });
    });

    const View = () => <Show when={menu()} keyed>{(current) => <Portal>
        <div ref={(element) => { root = element; }} role="menu" aria-label="贝塞尔节点" tabIndex={-1} data-overlay-synthetic-target="direct"
            class="otter-context-menu-shell fixed z-[10000] p-1 text-xs"
            style={{ left: `${current.x}px`, top: `${current.y}px`, "max-width": "calc(100vw - 8px)" }}
            onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
            <button type="button" role="menuitem" class="otter-context-menu-item otter-context-menu-item--danger px-3 py-2 text-left disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={current.annotation.points.length <= 4} title={current.annotation.points.length <= 4 ? "至少保留一段曲线" : undefined}
                onClick={() => void removeNode().catch((error) => console.error("[Otter] Delete bezier node failed", error))}>
                删除节点
            </button>
        </div>
    </Portal>}</Show>;
    return { onContextMenu, View };
};
