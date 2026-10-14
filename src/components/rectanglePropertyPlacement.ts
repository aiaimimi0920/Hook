import { createEffect, onCleanup, type Accessor } from "solid-js";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { syncTopStripBackendRects } from "../services/stickerTopStripSync";

/** 属性条与主编辑栏外框左对齐，屏幕避让后同步原生命中区。 */
export const createRectanglePropertyPlacement = (options: {
    panel: () => HTMLDivElement | undefined;
    enabled: Accessor<boolean>;
    frame: Accessor<unknown>;
    unitId: Accessor<string>;
}) => {
    createEffect(() => {
        options.frame();
        if (!options.enabled()) return;
        const id = `rectangle-property-${options.unitId()}`;
        let raf = 0;
        let positioned: HTMLDivElement | undefined;
        const sync = () => {
            const panel = options.panel();
            const mainBar = panel?.closest("[data-otter-drag-follow-unit-id]")
                ?.querySelector<HTMLElement>(".otter-edit-strip");
            if (!panel || !mainBar) return;
            positioned = panel;
            const width = document.documentElement.clientWidth || window.innerWidth;
            const height = document.documentElement.clientHeight || window.innerHeight;
            panel.style.maxWidth = `${Math.max(0, width - 8)}px`;
            panel.style.transform = "none";
            const rect = panel.getBoundingClientRect();
            const bar = mainBar.getBoundingClientRect();
            const left = Math.max(4, Math.min(bar.left, width - rect.width - 4));
            const above = bar.top - rect.height;
            const top = Math.max(4, Math.min(above >= 4 ? above : bar.bottom, height - rect.height - 4));
            panel.style.transform = `translate(${left - rect.left}px, ${top - rect.top}px)`;
            panel.classList.toggle("rectangle-properties-scroll", panel.scrollWidth > panel.clientWidth);
            addOrUpdateRect({ id, x: left, y: top, width: rect.width, height: rect.height, name: "STICKER_TOP_STRIP_MENU" });
            syncTopStripBackendRects();
        };
        const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sync); };
        schedule();
        window.addEventListener("resize", schedule);
        onCleanup(() => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", schedule);
            positioned?.style.removeProperty("transform");
            positioned?.style.removeProperty("max-width");
            positioned?.classList.remove("rectangle-properties-scroll");
            removeRect(id);
            syncTopStripBackendRects();
        });
    });
};
