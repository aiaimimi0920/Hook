import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type Component } from "solid-js";
import { Portal } from "solid-js/web";
import { api } from "../services/api";
import { graphStore } from "../store/graphStore";
import { stickerToolSettings, uiActions } from "../store/uiStore";
import { captureStickerEditSnapshot } from "../services/stickerHistory";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { syncTopStripBackendRects } from "../services/stickerTopStripSync";
import { registerDragFollowerElement, unregisterDragFollowerElement } from "../services/dragFollowerRegistry";
import { placeStickerSettings } from "../services/stickerSettingsPlacement";
import { createPropertyBarCropController } from "./stickerTopStripPropertyBarCropController";
import { toolbarButtonClass } from "./stickerTopStripChrome";
import { createStickerTopStripHover } from "./stickerTopStripHover";
import { StickerSettingsFields, StickerSettingsIcon } from "./StickerSettingsFields";
import { StickerSettingsExtras } from "./StickerSettingsExtras";
import { FitImageFrameButton } from "./FitImageFrameButton";
import { ProjectionSettings } from "./ProjectionSettings";
import { LoomConnectionSettings } from "./LoomConnectionSettings";
import { DISABLED_PREFIX } from "../constants";
import { normalizeImageSourceForDisplay } from "../services/imageSource";
import { resolveUnitImageFromGraph } from "../services/graphImageResolution";
import { syncStickerEditAfterLocalCommit } from "../services/stickerTopStripSync";
import "../styles/rectangle-properties.css";
import "../styles/sticker-settings.css";

interface SettingsProps {
    unitId: string; x: number; y: number; width: number; height: number;
    onOpen: () => void;
}

const SettingsPanel: Component<SettingsProps> = (props) => {
    let panel: HTMLDivElement | undefined;
    const unit = createMemo(() => graphStore.units.find((item) => item.id === props.unitId));
    const displaySrc = () => {
        const current = unit();
        if (!current) return "";
        let source: string | undefined;
        if (current.params.image !== DISABLED_PREFIX) {
            const link = graphStore.links.find((item) => item.toUnitId === current.id && item.toPortId === "image");
            if (link) source = resolveUnitImageFromGraph({ units: graphStore.units, links: graphStore.links, capabilities: graphStore.capabilities, unitId: link.fromUnitId });
            const manual = current.params.image_path;
            if (typeof manual === "string" && manual.startsWith("data:")) source = manual;
        }
        return normalizeImageSourceForDisplay(source || current.data.previewSrc || current.data.src || "") || "";
    };
    const fitFrame = (size: { w: number; h: number }) => {
        const current = unit();
        if (!current || (current.w === size.w && current.h === size.h)) return;
        uiActions.pushStickerHistory(current.id, captureStickerEditSnapshot(current));
        graphStore.actions.resizeStickerFrame(current.id, { x: current.x, y: current.y, ...size });
        syncStickerEditAfterLocalCommit();
    };
    const controller = createPropertyBarCropController({
        unitId: () => props.unitId, unit,
        pushCurrentStickerHistory: (includeImageData = false) => {
            const current = unit();
            if (!current) return false;
            uiActions.pushStickerHistory(props.unitId, captureStickerEditSnapshot(current, { includeImageData }));
            return true;
        },
    });
    const hover = createStickerTopStripHover();
    onCleanup(hover.clear);
    onMount(() => panel?.focus({ preventScroll: true }));
    createEffect(() => {
        const frame = { x: props.x, y: props.y, w: props.width, h: props.height };
        const unitId = props.unitId;
        const element = panel;
        if (!element) return;
        const id = `sticker-settings-${unitId}`;
        let raf = 0;
        const sync = () => {
            const viewport = { w: document.documentElement.clientWidth || window.innerWidth, h: document.documentElement.clientHeight || window.innerHeight };
            const placed = placeStickerSettings(frame, viewport, { w: 125, h: element.scrollHeight ? element.scrollHeight + 2 : 160 });
            Object.assign(element.style, { left: `${placed.x}px`, top: `${placed.y}px`, width: `${placed.w}px`, maxHeight: `${viewport.h}px` });
            const rect = element.getBoundingClientRect();
            addOrUpdateRect({ id, x: rect.left, y: rect.top, width: rect.width, height: rect.height, name: "STICKER_TOP_STRIP_MENU" });
            syncTopStripBackendRects();
        };
        const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sync); };
        registerDragFollowerElement(unitId, element);
        schedule();
        const observer = new ResizeObserver(schedule);
        observer.observe(element);
        window.addEventListener("resize", schedule);
        onCleanup(() => {
            cancelAnimationFrame(raf); window.removeEventListener("resize", schedule);
            observer.disconnect();
            unregisterDragFollowerElement(unitId, element); removeRect(id); syncTopStripBackendRects();
        });
    });
    return <Portal><div ref={(element) => { panel = element; }} class="sticker-settings-stack" aria-label="贴图设置面板" role="region" tabIndex={-1} data-otter-global-shortcuts="ignore"
        data-otter-drag-follow-unit-id={props.unitId}
        onPointerOver={hover.over} onPointerOut={hover.out}
        onPointerDown={(event) => { event.stopPropagation(); void api.focusOverlayWindow(); }}
        onMouseDown={(event) => event.stopPropagation()}>
        <div class="sticker-settings-panel"><StickerSettingsFields controller={controller} height={unit()?.h ?? props.height}
            fitButton={<FitImageFrameButton unit={unit()} displaySrc={displaySrc()} onFit={fitFrame} />}
            flippedX={!!unit()?.data.imageEditState?.flippedX} flippedY={!!unit()?.data.imageEditState?.flippedY} />
        <StickerSettingsExtras unit={unit()} />
        </div>
        <LoomConnectionSettings frame={{ x: props.x, y: props.y, w: props.width, h: props.height }} />
        <ProjectionSettings unitId={props.unitId} frame={{ x: props.x, y: props.y, w: props.width, h: props.height }} />
    </div></Portal>;
};

/** Unit-wide settings remain separate from the active annotation/crop tool. */
export const StickerSettings: Component<SettingsProps & { available?: boolean }> = (props) => {
    const [open, setOpen] = createSignal(false);
    createEffect(on(
        () => [props.unitId, stickerToolSettings.activeTool, stickerToolSettings.activeCanvasTool, stickerToolSettings.domain],
        () => setOpen(false),
    ));
    return <Show when={props.available !== false}>
        <button type="button" class={toolbarButtonClass} aria-label="贴图设置" title="贴图设置" aria-expanded={open()}
            classList={{ "otter-toolbar-button--active": open(), "otter-toolbar-idle": !open() }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => { if (!open()) props.onOpen(); setOpen(!open()); }}><StickerSettingsIcon /></button>
        <Show when={open()}><SettingsPanel {...props} /></Show>
    </Show>;
};
