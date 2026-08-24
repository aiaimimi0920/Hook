import { Component, Show, createEffect, onCleanup } from "solid-js";
import {
    EXEC_listenUpstream,
    EXEC_notifyDownstream,
    EXEC_paramDriven,
    EXEC_upstreamDriven,
    PARAM_ui_resize,
} from "../constants";
import { api } from "../services/api";
import { syncService } from "../services/syncService";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { graphStore } from "../store/graphStore";
import { setLayoutTick } from "../store/uiStore";
import { NodeExecutionConfig, Unit } from "../types/unit";

interface UnitParamsExpandedSettingsProps {
    unit: Unit;
    expanded: boolean;
    execConfig?: NodeExecutionConfig;
    displaySrc: string;
    onParamChange: (propId: string, value: unknown, isFinal?: boolean) => void;
}

/** Owns execution controls and their registered floating-panel geometry. */
export const UnitParamsExpandedSettings: Component<UnitParamsExpandedSettingsProps> = (props) => {
    let settingsPanelRef: HTMLDivElement | undefined;
    let disposed = false;
    let resizeGeneration = 0;
    let activeResizeImage: HTMLImageElement | undefined;
    let layoutTimerId: number | undefined;
    const acceptsUpstreamStickerEditPropagation = () =>
        props.unit.data.stickerEditPropagation?.acceptUpstream ?? true;
    const setAcceptsUpstreamStickerEditPropagation = (acceptUpstream: boolean) => {
        graphStore.actions.updateUnitData(props.unit.id, {
            stickerEditPropagation: {
                ...props.unit.data.stickerEditPropagation,
                acceptUpstream,
            },
        });
        void syncService.performWorkflowSync();
    };
    const focusOverlayFromPointerEvent = (event: PointerEvent | MouseEvent) => {
        event.stopPropagation();
        void api.focusOverlayWindow();
    };

    createEffect(() => {
        const unit = props.unit;
        const isExpanded = props.expanded;
        const updateExecRect = () => {
            if (!isExpanded || !settingsPanelRef?.isConnected) return;
            const rect = settingsPanelRef.getBoundingClientRect();
            const scale = rect.width > 0 ? rect.width / 180 : 1;
            addOrUpdateRect({
                id: `exec-settings-${unit.id}`,
                x: unit.x + unit.w / 2 + 125 + 8,
                y: unit.y + unit.h + 12,
                width: 180,
                height: rect.height / scale + 20,
                name: "EXEC_SETTINGS",
            });
        };

        if (isExpanded) {
            const rafId = requestAnimationFrame(updateExecRect);
            let observer: ResizeObserver | null = null;
            if (typeof ResizeObserver !== "undefined" && settingsPanelRef) {
                observer = new ResizeObserver(updateExecRect);
                observer.observe(settingsPanelRef);
            }
            onCleanup(() => {
                cancelAnimationFrame(rafId);
                observer?.disconnect();
                removeRect(`exec-settings-${unit.id}`);
            });
        } else {
            removeRect(`exec-settings-${unit.id}`);
        }
    });
    onCleanup(() => {
        disposed = true;
        resizeGeneration += 1;
        if (activeResizeImage) {
            activeResizeImage.onload = null;
            activeResizeImage.onerror = null;
            activeResizeImage = undefined;
        }
        if (layoutTimerId !== undefined) {
            window.clearTimeout(layoutTimerId);
            layoutTimerId = undefined;
        }
    });

    const resizeUnitToImage = () => {
        const src = props.displaySrc;
        if (!src) return;
        const unitId = props.unit.id;
        const unitWidth = props.unit.w;
        const unitHeight = props.unit.h;
        const generation = ++resizeGeneration;
        if (activeResizeImage) {
            activeResizeImage.onload = null;
            activeResizeImage.onerror = null;
        }
        const image = new Image();
        activeResizeImage = image;
        const isCurrentRequest = () =>
            !disposed &&
            generation === resizeGeneration &&
            props.expanded &&
            props.unit.id === unitId &&
            props.displaySrc === src;
        const isCurrentGeometry = () =>
            isCurrentRequest() && props.unit.w === unitWidth && props.unit.h === unitHeight;
        image.onload = () => {
            if (!isCurrentGeometry()) return;
            const imageWidth = image.naturalWidth || image.width;
            const imageHeight = image.naturalHeight || image.height;
            if (
                !Number.isFinite(imageWidth) ||
                !Number.isFinite(imageHeight) ||
                imageWidth <= 0 ||
                imageHeight <= 0 ||
                !Number.isFinite(unitWidth) ||
                !Number.isFinite(unitHeight) ||
                unitWidth <= 0 ||
                unitHeight <= 0
            ) {
                return;
            }
            const aspect = imageWidth / imageHeight;
            const nodeAspect = unitWidth / unitHeight;
            let width = unitWidth;
            let height = unitHeight;
            if (aspect > nodeAspect) height = unitWidth / aspect;
            else width = unitHeight * aspect;
            props.onParamChange(PARAM_ui_resize, { w: width, h: height });
            activeResizeImage = undefined;
            if (layoutTimerId !== undefined) window.clearTimeout(layoutTimerId);
            // eslint-disable-next-line solid/reactivity -- the delayed guard intentionally reads the latest props before publishing layout work.
            layoutTimerId = window.setTimeout(() => {
                layoutTimerId = undefined;
                if (isCurrentRequest()) setLayoutTick((tick) => tick + 1);
            }, 50);
        };
        image.onerror = () => {
            if (generation === resizeGeneration) activeResizeImage = undefined;
        };
        image.src = src;
    };

    return (
        <Show when={props.expanded}>
            <div
                ref={settingsPanelRef}
                class="hook-terminal-shell hook-terminal-shell--strong absolute z-[101] pointer-events-auto animate-in fade-in slide-in-from-left-2 duration-200"
                style={{
                    position: "absolute",
                    left: "calc(50% + 125px + 8px)",
                    top: "calc(100% + 12px)",
                    width: "180px",
                    padding: "12px",
                }}
                onPointerDown={focusOverlayFromPointerEvent}
                onMouseDown={focusOverlayFromPointerEvent}
                onClick={(event) => event.stopPropagation()}
                onDblClick={(event) => event.stopPropagation()}
            >
                <div
                    class="text-[10px] uppercase tracking-wider mb-2 pb-1.5"
                    style={{
                        color: "var(--text-muted)",
                        "border-bottom": "1px solid var(--glass-border)",
                        "font-weight": "500",
                    }}
                >
                    执行设置
                </div>
                <div class="flex items-center justify-between gap-3 mb-2">
                    <SettingCheckbox
                        checked={props.execConfig?.triggerMode?.upstreamDriven ?? true}
                        label="上游驱动"
                        onChange={(checked) => props.onParamChange(EXEC_upstreamDriven, checked)}
                    />
                    <SettingCheckbox
                        checked={props.execConfig?.triggerMode?.paramDriven ?? true}
                        label="参数驱动"
                        onChange={(checked) => props.onParamChange(EXEC_paramDriven, checked)}
                    />
                </div>
                <div class="flex items-center justify-between gap-3">
                    <SettingCheckbox
                        checked={props.execConfig?.propagation?.listenUpstream ?? true}
                        label="⬅ 监听上游"
                        accent="var(--accent-blue)"
                        onChange={(checked) => props.onParamChange(EXEC_listenUpstream, checked)}
                    />
                    <SettingCheckbox
                        checked={props.execConfig?.propagation?.notifyDownstream ?? true}
                        label="通知下游 ➡"
                        accent="var(--accent-blue)"
                        onChange={(checked) => props.onParamChange(EXEC_notifyDownstream, checked)}
                    />
                </div>

                <Show when={props.unit.type === "sticker"}>
                    <div class="hook-separator h-px w-full my-2" />
                    <label class="flex items-center justify-between gap-2 cursor-pointer select-none group">
                        <span class="text-[11px] leading-4" style={{ color: "var(--text-secondary)", opacity: "0.9" }}>
                            接受上级贴图编辑传导
                        </span>
                        <input
                            type="checkbox"
                            checked={acceptsUpstreamStickerEditPropagation()}
                            onChange={(event) => {
                                event.stopPropagation();
                                setAcceptsUpstreamStickerEditPropagation(event.currentTarget.checked);
                            }}
                            class="w-3.5 h-3.5 rounded cursor-pointer"
                            style={{ "accent-color": "var(--accent-blue)" }}
                        />
                    </label>
                    <Show when={props.unit.data.stickerEditPropagation?.locallyEdited}>
                        <div class="hook-locally-edited mt-1 text-[10px]">已本地编辑</div>
                    </Show>
                </Show>

                <div class="hook-separator h-px w-full my-2" />
                <button
                    class={`hook-terminal-btn w-full flex items-center justify-center gap-2 h-7 text-[11px] font-medium transition-all ${props.displaySrc ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        resizeUnitToImage();
                    }}
                    disabled={!props.displaySrc}
                    title={props.displaySrc ? "适配图片比例" : "暂无图片内容"}
                >
                    <svg class={`w-3.5 h-3.5 ${props.displaySrc ? "opacity-70" : "opacity-30"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M16 20h2a2 2 0 012-2v-2M4 16v2a2 2 0 002 2h2M9 10h6v4H9z" />
                    </svg>
                    合拢外框
                </button>
            </div>
        </Show>
    );
};

interface SettingCheckboxProps {
    checked: boolean;
    label: string;
    accent?: string;
    onChange: (checked: boolean) => void;
}

const SettingCheckbox: Component<SettingCheckboxProps> = (props) => (
    <label class="flex items-center gap-1.5 cursor-pointer select-none group">
        <input
            type="checkbox"
            checked={props.checked}
            onChange={(event) => {
                event.stopPropagation();
                props.onChange(event.currentTarget.checked);
            }}
            class="w-3.5 h-3.5 rounded cursor-pointer"
            style={{ "accent-color": props.accent || "var(--primary)" }}
        />
        <span
            class="text-[11px] group-hover:opacity-100 transition-opacity"
            style={{ color: "var(--text-secondary)", opacity: "0.85" }}
        >
            {props.label}
        </span>
    </label>
);
