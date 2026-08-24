import { Component, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { UnitNativeStickerDragPreviewModel } from "./unitNativeStickerDragController";

interface UnitNativeStickerDragPreviewProps {
    preview: UnitNativeStickerDragPreviewModel | null;
}

/** Renders the pointer-following preview outside the clipped unit surface. */
export const UnitNativeStickerDragPreview: Component<UnitNativeStickerDragPreviewProps> = (props) => (
    <Show when={props.preview} keyed>
        {(preview) => (
            <Portal>
                <div
                    class="hook-sticker-export-drag-preview"
                    style={{
                        position: "fixed",
                        left: `${preview.x + 18}px`,
                        top: `${preview.y + 18}px`,
                        width: `${preview.width}px`,
                        height: `${preview.height}px`,
                        "z-index": "2147483647",
                        "pointer-events": "none",
                        opacity: "0.86",
                        border: "1px solid rgba(219, 255, 0, 0.85)",
                        background: "rgba(0, 0, 0, 0.25)",
                        "box-shadow": "0 4px 16px rgba(0, 0, 0, 0.35)",
                    }}
                >
                    <img
                        src={preview.src}
                        draggable={false}
                        style={{
                            width: "100%",
                            height: "100%",
                            "object-fit": "contain",
                            display: "block",
                        }}
                    />
                </div>
            </Portal>
        )}
    </Show>
);
