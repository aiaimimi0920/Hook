import { createEffect, createSignal, onCleanup, Show, type Component } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { Portal } from "solid-js/web";

import { api } from "../services/api";
import { uiActions } from "../store/uiStore";
import type { ColorPickerPreview, GlobalColorPickerMousePayload } from "./stickerAnnotationModel";

interface StickerDesktopColorPickerOverlayProps {
    active: boolean;
}

const isRgbByte = (value: unknown): value is number =>
    Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 255;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object";

const finiteCoordinate = (...values: unknown[]) =>
    values.find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? 0;

const rgbToHex = (rgb: ColorPickerPreview["rgb"]) =>
    `#${[rgb.r, rgb.g, rgb.b]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")}`;

// Tauri event payloads cross a runtime boundary, so reject malformed colors
// before they reach CSS or persisted tool history.
export const normalizeDesktopColorPickerPayload = (
    payload: unknown,
): ColorPickerPreview | null => {
    if (!isRecord(payload)) return null;
    if (typeof payload.hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(payload.hex)) return null;
    const rgb = payload.rgb;
    if (
        !isRecord(rgb) ||
        !isRgbByte(rgb.r) ||
        !isRgbByte(rgb.g) ||
        !isRgbByte(rgb.b)
    ) {
        return null;
    }
    const normalizedRgb = { r: rgb.r, g: rgb.g, b: rgb.b };
    if (rgbToHex(normalizedRgb) !== payload.hex.toLowerCase()) return null;
    return {
        x: finiteCoordinate(payload.x, payload.globalX),
        y: finiteCoordinate(payload.y, payload.globalY),
        hex: payload.hex,
        rgb: normalizedRgb,
    };
};

export const createSerializedColorPickerStateQueue = (
    applyState: (active: boolean) => Promise<void>,
) => {
    let tail = Promise.resolve();
    return (active: boolean) => {
        const task = tail.then(() => applyState(active));
        tail = task.catch(() => undefined);
        return task;
    };
};

const renderColorPickerPreview = (preview: ColorPickerPreview) => {
    const viewportWidth = typeof window === "undefined" ? 1920 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 1080 : window.innerHeight;
    const left = Math.min(Math.max(8, preview.x + 16), Math.max(8, viewportWidth - 152));
    const top = Math.min(Math.max(8, preview.y + 16), Math.max(8, viewportHeight - 56));

    return (
        <div
            class="hook-color-sample-tooltip pointer-events-none fixed z-[10000] px-2 py-1 text-[11px] font-semibold"
            style={{
                left: `${left}px`,
                top: `${top}px`,
                position: "fixed",
            }}
        >
            <div class="flex items-center gap-2">
                <span
                    class="hook-color-sample-tooltip__swatch h-5 w-5"
                    style={{ background: preview.hex }}
                />
                <span>取色预览 {preview.hex}</span>
            </div>
        </div>
    );
};

// Own the global picker subscriptions so late async unlisteners and capture
// activation are always paired with this overlay's reactive lifetime.
export const StickerDesktopColorPickerOverlay: Component<StickerDesktopColorPickerOverlayProps> = (props) => {
    const [colorPickerPreview, setColorPickerPreview] = createSignal<ColorPickerPreview | null>(null);
    let sessionGeneration = 0;
    let committedGeneration = -1;
    const queueBackendState = createSerializedColorPickerStateQueue(async (active) => {
        const results = await Promise.allSettled([
            api.setDesktopColorPickerActive(active),
            api.setCaptureInputActive(active),
        ]);
        for (const result of results) {
            if (result.status === "rejected") {
                console.warn("[Hook] Failed to update desktop color picker capture state", result.reason);
            }
        }
    });

    const applyDesktopColorPickerSample = (
        payload: unknown,
        commit: boolean,
        generation: number,
    ) => {
        if (generation !== sessionGeneration || (commit && committedGeneration === generation)) return;
        const sample = normalizeDesktopColorPickerPayload(payload);
        if (!sample) return;
        setColorPickerPreview(sample);

        if (commit) {
            committedGeneration = generation;
            uiActions.setStickerSampledColor(sample.hex);
            uiActions.setStickerSampledRgb(sample.rgb);
            uiActions.setStickerActiveColor(sample.hex);
            uiActions.recordColorHistory({ hex: sample.hex, rgb: sample.rgb });
            const returnTool = uiActions.consumeStickerColorPickerReturnMode();
            if (returnTool) {
                uiActions.setStickerActiveTool(returnTool);
            }
        }
    };

    createEffect(() => {
        const generation = ++sessionGeneration;
        if (!props.active) {
            setColorPickerPreview(null);
            return;
        }

        let disposed = false;
        const unlisteners: Array<() => void> = [];

        void queueBackendState(true).catch((error) => {
            console.warn("[Hook] Failed to activate desktop color picker capture", error);
        });
        void listen<GlobalColorPickerMousePayload>("capture/global_mouse_move", (event) => {
            if (disposed) return;
            applyDesktopColorPickerSample(event.payload, false, generation);
        })
            .then((unlisten) => {
                if (disposed) {
                    unlisten();
                    return;
                }
                unlisteners.push(unlisten);
            })
            .catch((error) => {
                console.warn("[Hook] Failed to listen for desktop color picker moves", error);
            });
        void listen<GlobalColorPickerMousePayload>("capture/global_mouse_down", (event) => {
            if (disposed) return;
            applyDesktopColorPickerSample(event.payload, true, generation);
        })
            .then((unlisten) => {
                if (disposed) {
                    unlisten();
                    return;
                }
                unlisteners.push(unlisten);
            })
            .catch((error) => {
                console.warn("[Hook] Failed to listen for desktop color picker clicks", error);
            });

        onCleanup(() => {
            disposed = true;
            unlisteners.forEach((unlisten) => unlisten());
            setColorPickerPreview(null);
            void queueBackendState(false).catch((error) => {
                console.warn("[Hook] Failed to deactivate desktop color picker capture", error);
            });
        });
    });

    return (
        <Show when={colorPickerPreview()} keyed>
            {(preview) => <Portal>{renderColorPickerPreview(preview)}</Portal>}
        </Show>
    );
};
