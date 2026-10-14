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
import { FitImageFrameButton } from "./FitImageFrameButton";
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

    return (
        <Show when={props.expanded}>
            <div
                ref={(el) => { settingsPanelRef = el; }}
                class="otter-terminal-shell otter-terminal-shell--strong absolute z-[101] pointer-events-auto animate-in fade-in slide-in-from-left-2 duration-200"
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
                    <div class="otter-separator h-px w-full my-2" />
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
                        <div class="otter-locally-edited mt-1 text-[10px]">已本地编辑</div>
                    </Show>
                </Show>

                <Show when={props.unit.type !== "sticker"}>
                    <div class="otter-separator h-px w-full my-2" />
                    <FitImageFrameButton legacy unit={props.unit} displaySrc={props.displaySrc} enabled={props.expanded}
                        onFit={(size) => props.onParamChange(PARAM_ui_resize, size)} />
                </Show>
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
