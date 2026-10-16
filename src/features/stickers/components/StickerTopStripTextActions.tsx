import { For, createSignal, onCleanup, type Component } from "solid-js";
import {
    stickerTextOverlayActions, textOverlayAvailable, textOverlayVisible, toggleStickerTextOverlay,
    type StickerTextOverlayAction,
} from "../services/stickerTextOverlayActions";
import { uiActions } from "../../workspace/state/uiStore";
import { toolbarButtonClass } from "./stickerTopStripChrome";

/** 按钮状态由实际覆盖层派生，不以点击次数模拟识别结果。 */
export const StickerTopStripTextActions: Component<{ unitId: string; onActivate: () => void }> = (props) => {
    const [pending, setPending] = createSignal<string>();
    let disposed = false;
    onCleanup(() => { disposed = true; });
    const toggle = async (action: StickerTextOverlayAction) => {
        if (pending() || !textOverlayAvailable(props.unitId, action)) return;
        const unitId = props.unitId;
        props.onActivate();
        uiActions.setStickerEditMode("select");
        setPending(action.id);
        try {
            await toggleStickerTextOverlay(unitId, action);
        } catch (error) {
            console.error(`[Otter] ${action.label} overlay failed`, error);
            if (!disposed) uiActions.showEnhancementNotice(unitId, {
                feature: "Loom",
                title: `${action.label}操作失败`,
                message: "请检查 Loom 连接及扩展状态后重试。",
            });
        } finally {
            if (!disposed) setPending(undefined);
        }
    };
    return (
        <For each={stickerTextOverlayActions}>
            {(action) => {
                const active = () => textOverlayVisible(props.unitId, action);
                const available = () => textOverlayAvailable(props.unitId, action);
                return (
                    <button
                        type="button"
                        class={toolbarButtonClass}
                        classList={{ "otter-toolbar-button--active": active() }}
                        aria-label={action.label}
                        aria-pressed={active()}
                        aria-busy={pending() === action.id}
                        disabled={!!pending() || !available()}
                        title={pending() === action.id ? `${action.label}处理中…`
                            : !available() ? `${action.label}不可用：请连接 Loom 并启用对应扩展`
                                : `${active() ? "隐藏" : "显示"}${action.label}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); void toggle(action); }}
                    >
                        {action.id === "ocr" ? (
                            <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8m-4 0v9m-2 0h4" />
                            </svg>
                        ) : (
                            <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M3 5h11M8 3v2m3 0c-1 6-4 9-8 11m2-8c1 3 4 6 7 7m1 6 4-11 4 11m-6.5-4h5" />
                            </svg>
                        )}
                    </button>
                );
            }}
        </For>
    );
};
