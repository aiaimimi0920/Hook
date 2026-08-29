import { Component, For, Show, createEffect, onCleanup } from "solid-js";

import { extensionCommandRouter } from "../services/extensionCommandRouter";
import {
    extensionVisualRegistry,
    type ExtensionVisualBounds,
    type ExtensionVisualDescriptor,
} from "../services/extensionVisualRegistry";
import { SURFACE_PROTOCOL_VERSION, type SurfaceEvent, type SurfaceSnapshot } from "../services/surfaceProtocol";
import { registerExtensionSurfaceInstance } from "../services/extensionSurfaceDiagnostics";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import type { Unit } from "../types/unit";
import type { UnitAttachment } from "../types/unitExtension";
import { DeclarativeSurface } from "./DeclarativeSurface";
import "./ExtensionUnitOverlayLayer.css";

interface Props {
    unit: Unit;
    isMinified: boolean;
    onActivate: () => void | Promise<void>;
}

interface SurfaceHostProps extends Props {
    attachment: UnitAttachment;
    descriptor: ExtensionVisualDescriptor;
}

const MAX_EXTENSION_VISUALS_PER_UNIT = 32;

const clippedBounds = (unit: Unit, bounds: ExtensionVisualBounds) => {
    const left = Math.min(Math.max(bounds.x, 0), unit.w);
    const top = Math.min(Math.max(bounds.y, 0), unit.h);
    const right = Math.min(Math.max(bounds.x + bounds.width, left), unit.w);
    const bottom = Math.min(Math.max(bounds.y + bounds.height, top), unit.h);
    return right > left && bottom > top
        ? { x: left, y: top, width: right - left, height: bottom - top }
        : null;
};

const rectId = (unitId: string, descriptorId: string, attachmentId: string) =>
    `EXTENSION_OVERLAY_${unitId}_${descriptorId}_${attachmentId}`;

const ExtensionSurfaceHost: Component<SurfaceHostProps> = (props) => {
    onCleanup(registerExtensionSurfaceInstance());
    createEffect(() => {
        const id = rectId(props.unit.id, props.descriptor.id, props.attachment.attachmentId);
        const bounds = clippedBounds(props.unit, props.descriptor.bounds);
        if (!props.isMinified && props.descriptor.commandId && bounds) {
            addOrUpdateRect({
                id,
                x: props.unit.x + bounds.x,
                y: props.unit.y + bounds.y,
                width: bounds.width,
                height: bounds.height,
                name: "EXTENSION_OVERLAY",
            });
        }
        onCleanup(() => removeRect(id));
    });

    const snapshot = (): SurfaceSnapshot => ({
        protocolVersion: SURFACE_PROTOCOL_VERSION,
        instanceId: [
            "extension",
            props.descriptor.scopeId,
            props.unit.id,
            props.attachment.attachmentId,
            props.descriptor.id,
        ].join(":"),
        attachmentId: props.attachment.attachmentId,
        artId: props.descriptor.pluginId,
        artVersion: props.descriptor.pluginVersion,
        revision: props.attachment.revision,
        runtime: "declarative",
        scene: props.descriptor.scene,
        authoritativeState: props.attachment.payload,
    });
    const style = () => {
        const bounds = clippedBounds(props.unit, props.descriptor.bounds);
        return bounds ? {
            left: `${bounds.x}px`,
            top: `${bounds.y}px`,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
        } : { display: "none" };
    };
    const onEvent = (event: SurfaceEvent) => {
        const commandId = props.descriptor.commandId;
        if (!commandId || event.action !== commandId) return;
        void Promise.resolve(props.onActivate())
            .then(() => extensionCommandRouter.execute(commandId))
            .catch((error) => console.error("Extension overlay command failed", error));
    };
    return (
        <div class="extension-unit-surface" style={style()}>
            <DeclarativeSurface
                unitId={props.unit.id}
                snapshot={snapshot()}
                generation={props.descriptor.generation}
                interactive={!props.isMinified && Boolean(props.descriptor.commandId)}
                onActivate={props.onActivate}
                onEvent={onEvent}
            />
        </div>
    );
};

/** Renders only bounded declarative extension visuals inside the owning unit clip. */
export const ExtensionUnitOverlayLayer: Component<Props> = (props) => {
    const attachments = () => props.unit.data.extensionState?.attachments ?? [];
    const visuals = () => attachments().flatMap((attachment) => {
        const renderer = extensionVisualRegistry.rendererFor(attachment);
        const overlays = extensionVisualRegistry.overlaysFor(attachment);
        return [...(renderer ? [renderer] : []), ...overlays].map((descriptor) => ({ attachment, descriptor }));
    }).slice(0, MAX_EXTENSION_VISUALS_PER_UNIT);
    const unavailable = () => attachments().filter((attachment) =>
        !extensionVisualRegistry.attachmentAvailable(attachment) || !extensionVisualRegistry.rendererFor(attachment));

    return (
        <>
            <Show when={!props.isMinified}>
                <For each={visuals()}>{({ attachment, descriptor }) => (
                    <ExtensionSurfaceHost {...props} attachment={attachment} descriptor={descriptor} />
                )}</For>
                <div class="extension-attachment-placeholders" aria-live="polite">
                    <For each={unavailable().slice(0, 8)}>{(attachment) => (
                        <div class="extension-attachment-placeholder" title={attachment.typeId}>
                            扩展数据不可用 · {attachment.typeId.slice(0, 64)}
                        </div>
                    )}</For>
                </div>
            </Show>
        </>
    );
};
