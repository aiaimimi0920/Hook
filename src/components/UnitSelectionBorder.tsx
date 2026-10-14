import { Show, createEffect, onCleanup, type Component } from "solid-js";
import { Portal } from "solid-js/web";
import { registerDragFollowerElement, unregisterDragFollowerElement } from "../services/dragFollowerRegistry";

interface UnitSelectionBorderProps {
    isSelected: boolean;
    opacity: number;
    editingFrame?: { unitId: string; x: number; y: number; w: number; h: number };
}

export const unitOutlineOutset = (selected: boolean) => selected ? 2 : 1;

/** Only the editing outline escapes the unit stacking context, never its content or hit area. */
export const UnitSelectionBorder: Component<UnitSelectionBorderProps> = (props) => {
    const border = () => <div class="selection-border" style={{
        inset: `${-unitOutlineOutset(props.isSelected)}px`,
        border: `${unitOutlineOutset(props.isSelected)}px solid ${props.isSelected ? "white" : `rgba(255,255,255,${Math.max(0.2, props.opacity)})`}`,
        "pointer-events": "none",
    }} />;
    return <Show when={props.editingFrame} fallback={border()} keyed>
        {(frame) => {
            const outset = unitOutlineOutset(true);
            let element: HTMLDivElement | undefined;
            createEffect(() => {
                const current = element;
                if (!current) return;
                registerDragFollowerElement(frame.unitId, current);
                onCleanup(() => unregisterDragFollowerElement(frame.unitId, current));
            });
            return <Portal><div ref={(value) => { element = value; }}
                class="sticker-editing-outline" aria-hidden="true"
                data-otter-drag-follow-unit-id={frame.unitId}
                style={{
                    position: "fixed", left: `${frame.x - outset}px`, top: `${frame.y - outset}px`,
                    width: `${frame.w + outset * 2}px`, height: `${frame.h + outset * 2}px`,
                    "box-sizing": "border-box", border: `${outset}px solid white`,
                    "z-index": 1230, "pointer-events": "none",
                }} /></Portal>;
        }}
    </Show>;
};
