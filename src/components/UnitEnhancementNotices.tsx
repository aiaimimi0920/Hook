import { Component, For, Show, createEffect, createMemo, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

import {
    registerDragFollowerElement,
    unregisterDragFollowerElement,
} from "../services/dragFollowerRegistry";
import { orderEnhancementNoticesForDisplay } from "../services/enhancementNoticeQueue";
import { enhancementNotices, uiActions } from "../store/uiStore";

interface UnitEnhancementNoticesProps {
    unitId: string;
    unitX: number;
    unitY: number;
    unitWidth: number;
    unitHeight: number;
    noticesLayer?: HTMLElement;
}

const NOTICE_INSET_PX = 8;
const NOTICE_MAX_WIDTH_PX = 280;
export const ENHANCEMENT_NOTICE_TIMEOUT_MS = 5_000;

const availableNoticeSize = (value: number, maximum = Number.POSITIVE_INFINITY) => {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(maximum, value - NOTICE_INSET_PX * 2));
};

/** Renders unit-scoped notices above, rather than inside, the clipped image layer. */
export const UnitEnhancementNotices: Component<UnitEnhancementNoticesProps> = (props) => {
    const dismissTimers = new Map<number, number>();
    let stackElement: HTMLDivElement | undefined;
    let wrapperElement: HTMLDivElement | undefined;
    let dragFollowerRegistration: { unitId: string; element: HTMLDivElement } | null = null;
    const notices = createMemo(() =>
        orderEnhancementNoticesForDisplay(enhancementNotices[props.unitId]),
    );
    const stackWidth = () => availableNoticeSize(props.unitWidth, NOTICE_MAX_WIDTH_PX);
    const stackHeight = () => availableNoticeSize(props.unitHeight);

    const clearDismissTimers = () => {
        dismissTimers.forEach((timer) => window.clearTimeout(timer));
        dismissTimers.clear();
    };

    const syncDragFollowerRegistration = () => {
        const unitId = props.unitId;
        const element = props.noticesLayer && notices().length > 0 ? wrapperElement : undefined;
        const registration = dragFollowerRegistration;
        if (registration && (registration.unitId !== unitId || registration.element !== element)) {
            unregisterDragFollowerElement(registration.unitId, registration.element);
            dragFollowerRegistration = null;
        }
        if (!element || dragFollowerRegistration) return;
        registerDragFollowerElement(unitId, element);
        dragFollowerRegistration = { unitId, element };
    };

    createEffect(() => {
        const unitId = props.unitId;
        const activeNotices = notices();
        const activeIds = new Set(activeNotices.map((notice) => notice.id));
        dismissTimers.forEach((timer, noticeId) => {
            if (activeIds.has(noticeId)) return;
            window.clearTimeout(timer);
            dismissTimers.delete(noticeId);
        });
        activeNotices.forEach((notice) => {
            if (dismissTimers.has(notice.id)) return;
            dismissTimers.set(notice.id, window.setTimeout(() => {
                dismissTimers.delete(notice.id);
                uiActions.dismissEnhancementNotice(unitId, notice.id);
            }, ENHANCEMENT_NOTICE_TIMEOUT_MS));
        });
        queueMicrotask(() => {
            if (stackElement) stackElement.scrollTop = 0;
        });
    });
    createEffect(syncDragFollowerRegistration);

    onCleanup(() => {
        clearDismissTimers();
        const registration = dragFollowerRegistration;
        if (registration) {
            unregisterDragFollowerElement(registration.unitId, registration.element);
            dragFollowerRegistration = null;
        }
    });

    return (
        <Show when={props.noticesLayer && notices().length > 0}>
            <Portal mount={props.noticesLayer!}>
              <div
                ref={(element) => {
                    wrapperElement = element;
                    syncDragFollowerRegistration();
                }}
                data-hook-unit-notice-anchor={props.unitId}
                data-hook-drag-follow-unit-id={props.unitId}
                class="absolute pointer-events-none"
                style={{
                    left: `${props.unitX}px`,
                    top: `${props.unitY}px`,
                    width: `${props.unitWidth}px`,
                    height: `${props.unitHeight}px`,
                }}
              >
              <div
                  ref={stackElement}
                  data-hook-unit-notice-layer="true"
                  class="hook-enhancement-notice-stack absolute right-2 top-2 flex flex-col items-end gap-2"
                  style={{
                      width: `${stackWidth()}px`,
                      "max-height": `${stackHeight()}px`,
                      "pointer-events": "auto",
                  }}
                  aria-label="贴图通知"
              >
                <For each={notices()}>{(notice) => (
                    <div
                        class="enhancement-notice hook-enhancement-notice p-3 text-left"
                        style={{
                            "max-height": `${Math.min(140, stackHeight())}px`,
                            "pointer-events": "auto",
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onMouseUp={(event) => event.stopPropagation()}
                        role="button"
                        aria-label={`${notice.title}：${notice.message}，点击关闭`}
                        tabIndex={0}
                        onClick={(event) => {
                            event.stopPropagation();
                            uiActions.dismissEnhancementNotice(props.unitId, notice.id);
                        }}
                        onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            event.stopPropagation();
                            uiActions.dismissEnhancementNotice(props.unitId, notice.id);
                        }}
                        onDblClick={(event) => event.stopPropagation()}
                    >
                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                                <div class="hook-enhancement-notice__title text-[11px] font-semibold">{notice.title}</div>
                                <div class="hook-enhancement-notice__copy mt-1 text-[10px] leading-snug break-words">{notice.message}</div>
                            </div>
                            <button
                                class="hook-terminal-btn shrink-0 px-2 py-1 text-[10px]"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    uiActions.dismissEnhancementNotice(props.unitId, notice.id);
                                }}
                            >
                                知道了
                            </button>
                        </div>
                    </div>
                )}</For>
              </div>
              </div>
            </Portal>
        </Show>
    );
};
