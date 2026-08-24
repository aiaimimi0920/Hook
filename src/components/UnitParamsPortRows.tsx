import { Component, For, Show, onCleanup } from "solid-js";
import { DISABLED_PREFIX } from "../constants";
import { getCapabilityInputsForPorts } from "../services/artPorts";
import { ArtCapability, ArtPortDefinition } from "../services/protocol";
import { graphStore } from "../store/graphStore";
import { Unit } from "../types/unit";

export type UnitParamsPanelPort = ArtPortDefinition & { description?: string };

export const MAX_INLINE_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_INLINE_IMAGE_DIMENSION = 32_768;
const MAX_INLINE_IMAGE_PIXELS = 100_000_000;
const INLINE_IMAGE_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/pjpeg",
    "image/webp",
    "image/bmp",
    "image/x-ms-bmp",
]);
const INLINE_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".bmp"];

export const isSupportedInlineImageFile = (file: File) => {
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_INLINE_IMAGE_BYTES) {
        return false;
    }
    const mimeType = file.type.trim().toLowerCase();
    if (mimeType) return INLINE_IMAGE_MIME_TYPES.has(mimeType);
    const fileName = file.name.trim().toLowerCase();
    return INLINE_IMAGE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
};

export const getUnitParamsPanelInputs = (
    unit: Unit,
    capability?: ArtCapability,
): UnitParamsPanelPort[] => {
    if (unit.type !== "art") {
        return [{ name: "image", label: "Image", type: "image", description: "Input image source" }];
    }
    return capability?.inputs
        ? getCapabilityInputsForPorts(capability)
        : [{ name: "input_image", label: "Input", type: "image" }];
};

export const getUnitParamsPanelOutputs = (
    unit: Unit,
    capability?: ArtCapability,
): UnitParamsPanelPort[] => {
    if (unit.type !== "art") {
        return [{ name: "output_image", label: "Image", type: "image" }];
    }
    return capability?.outputs || [{ name: "output_image", label: "Image", type: "image" }];
};

interface UnitParamsPortRowsProps {
    unit: Unit;
    params: Record<string, unknown>;
    capability?: ArtCapability;
    onParamChange: (propId: string, value: unknown, isFinal?: boolean) => void;
    onLinkStart: (propId: string, startX: number, startY: number) => void;
    onLinkDrop: (propId: string) => void;
    onLinkMove?: (portId: string, event: MouseEvent) => void;
    registerPanelPort: (element: HTMLElement, portName: string) => void;
    toggleParamDisabled: (paramId: string) => void;
}

/** Renders panel input/output rows while keeping graph-port policy in one owner. */
export const UnitParamsPortRows: Component<UnitParamsPortRowsProps> = (props) => {
    let disposed = false;
    let uploadGeneration = 0;
    let activeReader: FileReader | undefined;
    let activeImageProbe: HTMLImageElement | undefined;
    const inputs = () => getUnitParamsPanelInputs(props.unit, props.capability);
    const outputs = () => getUnitParamsPanelOutputs(props.unit, props.capability);
    const isArt = () => props.unit.type === "art";

    const isPortVisible = (portName: string) => {
        const userVisibility = props.unit.data.portVisibility?.[portName];
        if (typeof userVisibility === "boolean") return userVisibility;
        const input = props.capability?.inputs?.find((port) => port.name === portName);
        if (input?.defaultVisible !== undefined) return input.defaultVisible;
        const output = props.capability?.outputs?.find((port) => port.name === portName);
        if (output?.defaultVisible !== undefined) return output.defaultVisible;
        return true;
    };

    const togglePortVisibility = (portName: string) => {
        const portVisibility = {
            ...props.unit.data.portVisibility,
            [portName]: !isPortVisible(portName),
        };
        graphStore.actions.updateUnitData(props.unit.id, { portVisibility });
    };

    const clearActiveUpload = () => {
        if (activeReader) {
            activeReader.onload = null;
            activeReader.onerror = null;
            if (activeReader.readyState === FileReader.LOADING) activeReader.abort();
            activeReader = undefined;
        }
        if (activeImageProbe) {
            activeImageProbe.onload = null;
            activeImageProbe.onerror = null;
            activeImageProbe = undefined;
        }
    };

    const readInlineImage = (file: File) => {
        const generation = ++uploadGeneration;
        clearActiveUpload();
        if (!isSupportedInlineImageFile(file)) return;

        const reader = new FileReader();
        activeReader = reader;
        const isCurrent = () => !disposed && generation === uploadGeneration;
        reader.onerror = () => {
            if (generation === uploadGeneration) activeReader = undefined;
        };
        reader.onload = (event) => {
            if (!isCurrent() || typeof event.target?.result !== "string") return;
            const dataUrl = event.target.result;
            if (!dataUrl.startsWith("data:")) return;
            activeReader = undefined;
            const image = new Image();
            activeImageProbe = image;
            image.onerror = () => {
                if (generation === uploadGeneration) activeImageProbe = undefined;
            };
            image.onload = () => {
                if (!isCurrent()) return;
                const width = image.naturalWidth || image.width;
                const height = image.naturalHeight || image.height;
                if (
                    !Number.isFinite(width) ||
                    !Number.isFinite(height) ||
                    width <= 0 ||
                    height <= 0 ||
                    width > MAX_INLINE_IMAGE_DIMENSION ||
                    height > MAX_INLINE_IMAGE_DIMENSION ||
                    width * height > MAX_INLINE_IMAGE_PIXELS
                ) {
                    activeImageProbe = undefined;
                    return;
                }
                activeImageProbe = undefined;
                props.onParamChange("image_path", dataUrl);
                props.onParamChange("image_filename", file.name);
            };
            image.src = dataUrl;
        };
        reader.readAsDataURL(file);
    };

    onCleanup(() => {
        disposed = true;
        uploadGeneration += 1;
        clearActiveUpload();
    });

    return (
        <>
            <Show when={inputs().length > 0}>
                <div class="flex-shrink-0 flex flex-col gap-2 p-4 pb-2 relative">
                    <For each={inputs()}>
                        {(input) => {
                            const isDisabled = () => props.params[input.name] === DISABLED_PREFIX;
                            return (
                                <div class="flex items-center gap-3 w-full h-6 relative group" style={isDisabled() ? { opacity: 0.5 } : {}}>
                                    <Show when={isDisabled()}>
                                        <div class="hook-port-disabled-line absolute top-1/2 left-0 right-0 h-[2px] z-[60] pointer-events-none" />
                                    </Show>
                                    <div
                                        class="hook-panel-port absolute w-6 h-6 rounded-full cursor-pointer hover:scale-110 transition-transform z-[50]"
                                        style={{ left: "-27px" }}
                                        data-port-type="input"
                                        data-port-name={input.name}
                                        data-panel-port="true"
                                        ref={(element) => props.registerPanelPort(element, input.name)}
                                        onMouseDown={(event) => {
                                            event.stopPropagation();
                                            props.onLinkMove?.(input.name, event);
                                        }}
                                        onMouseUp={(event) => {
                                            event.stopPropagation();
                                            props.onLinkDrop(input.name);
                                        }}
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            props.toggleParamDisabled(input.name);
                                        }}
                                    />
                                    <span
                                        class="font-bold text-[11px] truncate relative z-10 drop-shadow-md cursor-context-menu"
                                        style={{ color: "var(--theme-text)", "max-width": "120px" }}
                                        title={`${input.label || input.name} (Right-click to disable)`}
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            props.toggleParamDisabled(input.name);
                                        }}
                                    >
                                        {input.label || input.name}
                                    </span>
                                    <button
                                        class={`hook-port-visibility w-4 h-4 flex items-center justify-center transition-colors ${isPortVisible(input.name) ? "" : "hook-port-visibility--hidden"}`}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            togglePortVisibility(input.name);
                                        }}
                                    >
                                        <Show when={isPortVisible(input.name)} fallback={<HiddenPortIcon />}>
                                            <VisiblePortIcon />
                                        </Show>
                                    </button>
                                    <Show when={!isArt() && input.name === "image"}>
                                        <div class="flex-1 flex justify-start min-w-0 ml-2">
                                            <label
                                                class={`hook-inline-upload flex items-center justify-start gap-1.5 h-5 px-2 transition-all cursor-pointer relative group ${props.params.image_path ? "hook-inline-upload--loaded" : ""}`}
                                                onContextMenu={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    props.onParamChange("image_path", "");
                                                    props.onParamChange("image_filename", "");
                                                }}
                                            >
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    class="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer z-50 block"
                                                    onChange={(event) => {
                                                        const file = event.currentTarget.files?.[0];
                                                        if (file) readInlineImage(file);
                                                        event.currentTarget.value = "";
                                                    }}
                                                />
                                                <div class="pointer-events-none flex items-center gap-1.5 relative z-0 min-w-0 flex-1 overflow-hidden">
                                                    <Show when={props.params.image_path && !isDisabled()} fallback={<span>Load</span>}>
                                                        <span>{String(props.params.image_filename || "Loaded")}</span>
                                                    </Show>
                                                </div>
                                            </label>
                                        </div>
                                    </Show>
                                </div>
                            );
                        }}
                    </For>
                    <div class="hook-separator h-px my-1" />
                </div>
            </Show>

            <Show when={outputs().length > 0}>
                <div class="flex-shrink-0 flex flex-col gap-2 p-4 pt-0 pb-2 relative">
                    <For each={outputs()}>
                        {(output) => {
                            const isDisabled = () => props.params[output.name] === DISABLED_PREFIX;
                            return (
                                <div class="flex items-center justify-end gap-3 w-full h-6 relative group" style={isDisabled() ? { opacity: 0.5 } : {}}>
                                    <Show when={isDisabled()}>
                                        <div class="hook-port-disabled-line absolute top-1/2 left-0 right-0 h-[2px] z-[60] pointer-events-none" />
                                    </Show>
                                    <div
                                        class="hook-panel-port absolute w-6 h-6 rounded-full cursor-cell hover:scale-110 transition-transform z-[50]"
                                        style={{ right: "-27px" }}
                                        data-port-type="output"
                                        data-port-name={output.name}
                                        data-panel-port="true"
                                        ref={(element) => props.registerPanelPort(element, output.name)}
                                        onMouseDown={(event) => {
                                            if (event.button !== 0) return;
                                            event.stopPropagation();
                                            props.onLinkStart(output.name, event.clientX, event.clientY);
                                        }}
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            props.toggleParamDisabled(output.name);
                                        }}
                                    />
                                    <button
                                        class={`hook-port-visibility w-4 h-4 flex items-center justify-center transition-colors mr-1 ${isPortVisible(output.name) ? "" : "hook-port-visibility--hidden"}`}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            togglePortVisibility(output.name);
                                        }}
                                    >
                                        <Show when={isPortVisible(output.name)} fallback={<HiddenPortIcon />}>
                                            <VisiblePortIcon />
                                        </Show>
                                    </button>
                                    <span
                                        class="font-bold text-[11px] truncate text-right relative z-10 drop-shadow-md cursor-context-menu"
                                        style={{ color: "var(--theme-text)", "max-width": "120px" }}
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            props.toggleParamDisabled(output.name);
                                        }}
                                    >
                                        {output.label || output.name}
                                    </span>
                                </div>
                            );
                        }}
                    </For>
                    <div class="hook-separator h-px my-1" />
                </div>
            </Show>
        </>
    );
};

const HiddenPortIcon: Component = () => (
    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
);

const VisiblePortIcon: Component = () => (
    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
);
