import { Component, Show } from "solid-js";
import {
    isSelecting,
    isBoxSelecting,
    selectionRect,
    startPos,
    preciseRect,
    captureMode,
    longCaptureSession,
} from "../store/uiStore";

export const CanvasSelection: Component = () => {
    return (
      <>
      <Show when={isSelecting()}>
        <div class="absolute inset-0 z-[2147483646] pointer-events-none">
            <Show when={captureMode() === "region" && !startPos()}>
                <div class="hook-capture-chip absolute left-1/2 top-5 -translate-x-1/2 px-3 py-1.5 text-[11px] font-semibold">
                    悬浮窗口可自动选择；双击截图完整窗口；拖动可自由框选；Esc 取消
                </div>
            </Show>
            <Show when={selectionRect()}>
                <div
                    class="absolute border-2 border-primary"
                    style={{
                        left: `${selectionRect()!.x}px`,
                        top: `${selectionRect()!.y}px`,
                        width: `${selectionRect()!.w}px`,
                        height: `${selectionRect()!.h}px`,
                    }}
                >
                     <div class="hook-capture-chip absolute -top-7 left-0 px-2 py-1 font-mono text-[11px] font-semibold">
                        <span>{Math.round(selectionRect()!.w)} x {Math.round(selectionRect()!.h)}</span>
                        <Show when={captureMode() === "long-vertical"}>
                            <span class="hook-capture-chip__tag px-1.5 py-[1px] text-[10px] font-semibold">长截图</span>
                        </Show>
                        <Show when={captureMode() === "region" && !startPos()}>
                            <span class="hook-capture-chip__tag px-1.5 py-[1px] text-[10px] font-semibold">窗口</span>
                        </Show>
                     </div>
                </div>

                <Show when={preciseRect()}>
                     <div
                        class="absolute border-2 border-dashed z-[2147483647] pointer-events-none"
                        style={{
                            left: `${preciseRect()!.x}px`,
                            top: `${preciseRect()!.y}px`,
                            width: `${preciseRect()!.w}px`,
                            height: `${preciseRect()!.h}px`,
                            "border-color": "#FFFF00",
                            "background-color": "rgba(255, 255, 0, 0.3)"
                        }}
                    />
                </Show>
            </Show>
        </div>
      </Show>

      <Show when={longCaptureSession()}>
        {(session) => (
            <div
                class="absolute z-[2147483646] pointer-events-none"
                style={{
                    left: `${session().rect.x}px`,
                    top: `${session().rect.y}px`,
                    width: `${session().rect.w}px`,
                    height: `${session().rect.h}px`,
                    outline: "2px solid rgba(217, 255, 56, 0.95)",
                    "outline-offset": "0px",
                }}
            >
                <div
                    class="hook-capture-chip absolute left-0 px-2 py-1 text-[11px] font-semibold"
                    style={{
                        top: session().rect.y >= 32 ? "-30px" : `${session().rect.h + 8}px`,
                    }}
                >
                    长截图区域 {Math.round(session().rect.w)} x {Math.round(session().rect.h)}
                </div>
            </div>
        )}
      </Show>

      <Show when={isBoxSelecting() && selectionRect()}>
          <div
              class="absolute border z-[2147483646] pointer-events-none"
              style={{
                  left: `${selectionRect()!.x}px`,
                  top: `${selectionRect()!.y}px`,
                  width: `${selectionRect()!.w}px`,
                  height: `${selectionRect()!.h}px`,
                  "border-color": "rgba(217, 255, 56, 0.92)",
                  "background-color": "rgba(217, 255, 56, 0.1)",
              }}
          />
      </Show>
    </>
    );
};
