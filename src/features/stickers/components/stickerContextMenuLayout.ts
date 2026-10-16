import { createEffect, onCleanup } from "solid-js";
import { stickerContextMenuController } from "../services/stickerContextMenuController";
import { placeStickerContextMenu, placeStickerSubmenu } from "../services/stickerContextMenuPlacement";
import { addOrUpdateRect, removeRect } from "../../../platform/desktop/uiRegistry";
import { syncService } from "../../workspace/services/syncService";

const RECT_ID = "sticker-context-menu-root";

// Position and native hit registration share the same measured geometry.
export function createStickerContextMenuLayout(root: () => HTMLDivElement | undefined, submenu: () => HTMLDivElement | undefined) {
    createEffect(() => {
        const state = stickerContextMenuController.state;
        if (!state.isOpen) return;
        const active = state.activeSubmenu;
        const anchor = { x: state.mouseX, y: state.mouseY };
        const fallbackTop = state.mouseY + state.submenuOffsetY;
        let frame = 0;
        let disposed = false;
        const position = () => {
            const primary = root();
            if (disposed || !primary) return;
            const bounds = { left: 8, top: 8, width: Math.max(1, window.innerWidth - 16), height: Math.max(1, window.innerHeight - 16) };
            primary.style.setProperty("--sticker-menu-max-height", `${bounds.height}px`);
            const size = primary.getBoundingClientRect();
            const placed = placeStickerContextMenu(anchor, size, bounds);
            primary.style.left = `${placed.left}px`;
            primary.style.top = `${placed.top}px`;
            const rect = primary.getBoundingClientRect();
            let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
            const secondary = active === "none" ? undefined : submenu();
            if (secondary) {
                const row = primary.querySelector<HTMLElement>(`[data-sticker-submenu="${active}"]`);
                const next = placeStickerSubmenu(rect, row?.getBoundingClientRect().top ?? fallbackTop, secondary.getBoundingClientRect(), bounds);
                secondary.style.left = `${next.left - rect.left}px`;
                secondary.style.top = `${next.top - rect.top}px`;
                secondary.dataset.side = next.side;
                const subRect = secondary.getBoundingClientRect();
                left = Math.min(left, subRect.left); top = Math.min(top, subRect.top);
                right = Math.max(right, subRect.right); bottom = Math.max(bottom, subRect.bottom);
            }
            if (right > left && bottom > top) {
                addOrUpdateRect({ id: RECT_ID, name: "STICKER_CONTEXT_MENU_ROOT", x: left, y: top, width: right - left, height: bottom - top });
                void syncService.updateBackendRects();
            }
        };
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
        schedule();
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
        if (root()) observer?.observe(root()!);
        if (active !== "none" && submenu()) observer?.observe(submenu()!);
        window.addEventListener("resize", schedule);
        onCleanup(() => {
            disposed = true;
            cancelAnimationFrame(frame);
            observer?.disconnect();
            window.removeEventListener("resize", schedule);
            removeRect(RECT_ID);
            void syncService.updateBackendRects();
        });
    });
}
