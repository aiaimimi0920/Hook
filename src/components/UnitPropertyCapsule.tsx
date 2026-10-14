import { createEffect, createSignal, type JSX } from "solid-js";
import { UnitPropertyTypeIcon, type PropertyType } from "./UnitPropertyTypeIcon";
import { createUnitPortGesture } from "./unitPortGesture";
import { linkingState } from "../store/uiStore";
import { unitPropertyDisclosure, setUnitPropertyDisclosure } from "../store/unitPropertyDisclosure";

export interface PropertyCapsuleProps {
    unitId?: string;
    name: string; label: string; type: PropertyType; side: "input" | "output";
    expanded: boolean; disabled?: boolean; hidden?: boolean; linked?: boolean;
    register: (element: HTMLElement, name: string) => void;
    onLinkStart?: (name: string, x: number, y: number) => void;
    onLinkMove?: (name: string, event: MouseEvent) => void;
    onLinkDrop?: (name: string) => void;
    onToggleDisable?: (name: string) => void;
    children: JSX.Element;
}

/** Collapsed markers hug the image; expanded markers move to the outer end of their row. */
export const UnitPropertyCapsule = (props: PropertyCapsuleProps) => {
    const [expanded, setExpanded] = createSignal(false);
    const gesture = createUnitPortGesture();
    createEffect(() => setExpanded(props.expanded));
    createEffect(() => {
        const request = unitPropertyDisclosure();
        if (request && request.unitId === props.unitId && request.name === props.name && request.side === props.side) {
            setExpanded(true);
            setUnitPropertyDisclosure(null);
        }
    });
    return <div
    class="unit-property-capsule" data-tab-hit-region
    classList={{ "is-expanded": expanded(), "is-output": props.side === "output", "is-disabled": props.disabled,
        "is-linked": props.linked, "is-port-hidden": props.hidden && !expanded() }}>
    <div class="unit-property-anchor" role="button" tabIndex={0} aria-label={`${props.label}连接点`} title={props.label}
        data-port-type={props.side} data-port-name={props.name} data-panel-port="true" aria-expanded={expanded()}
        ref={(element) => props.register(element, props.name)}
        onMouseDown={(event) => gesture(event, {
            click: () => setExpanded(!expanded()),
            drag: (center, move) => {
                if (props.side === "output") props.onLinkStart?.(props.name, center.x, center.y);
                else props.onLinkMove?.(props.name, move);
            },
        })}
        onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setExpanded(!expanded()); }
        }}
        onMouseUp={(event) => { event.stopPropagation(); if (props.side === "input" && linkingState().isLinking) props.onLinkDrop?.(props.name); }}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); props.onToggleDisable?.(props.name); }}>
        <UnitPropertyTypeIcon type={props.type} />
    </div>
    <div class="unit-property-body" inert={!expanded()} aria-hidden={!expanded()}>{props.children}</div>
</div>;
};
