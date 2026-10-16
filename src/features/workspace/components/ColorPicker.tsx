import { Component, createSignal, createEffect, onMount, onCleanup, For, Show, untrack } from "solid-js";

import { addOrUpdateRect, removeRect } from "../../../platform/desktop/uiRegistry";
import { syncService } from "../services/syncService";
import { hexToRgb, hsvToRgb, normalizeHexColor, rgbToHex, rgbToHsv } from "./ColorPicker/colorMath";
import "../styles/color-picker.css";

const COLOR_PICKER_RECT_ID = "color-picker-popup";
const COLOR_PICKER_RECT_NAME = "COLOR_PICKER";

interface ColorPickerProps {
    value: string;
    onChange: (color: string) => void;
    onClose: () => void;
    palette?: string[];
    onAddToPalette?: (color: string) => void;
    onRemoveFromPalette?: (color: string) => void;
    defaultPalette?: string[];
    onPickFromScreen?: () => void;
}


interface ColorPickerPropsExtended extends ColorPickerProps {
    anchorRect?: { x: number; y: number; width: number; height: number };
}

export const ColorPicker: Component<ColorPickerPropsExtended> = (props) => {
    const [hue, setHue] = createSignal(0);
    const [saturation, setSaturation] = createSignal(0);
    const [value, setValue] = createSignal(0);
    const [alpha, setAlpha] = createSignal(1);
    const [selectedPaletteColor, setSelectedPaletteColor] = createSignal<string | null>(null);
    // Draft text for the editable hex field. Decoupled from the color state so the
    // user can type partial/intermediate values (e.g. while entering an 8-digit
    // alpha hex) without the field snapping back to a fallback color.
    const [hexDraft, setHexDraft] = createSignal("");
    const [hexEditing, setHexEditing] = createSignal(false);
    const [panelHeight, setPanelHeight] = createSignal(320);
    const [viewport, setViewport] = createSignal({ width: window.innerWidth, height: window.innerHeight });

    let svPickerRef: HTMLDivElement | undefined;
    let hueSliderRef: HTMLDivElement | undefined;
    let alphaSliderRef: HTMLDivElement | undefined;
    let panelRef: HTMLDivElement | undefined;
    let lastSyncedExternalValue: string | undefined;

    const currentColor = () => {
        const rgb = hsvToRgb(hue(), saturation(), value());
        return rgbToHex(rgb.r, rgb.g, rgb.b, alpha());
    };

    const isValidHex = (hex: string) => {
        const normalized = normalizeHexColor(hex);
        return normalized !== null && normalized !== "transparent";
    };

    const loadColor = (hex: string) => {
        const parsed = hexToRgb(hex);
        const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
        // Grayscale (and fully transparent) inputs have an undefined hue; keep the
        // current hue so the handle doesn't jump to red and the user's hue is kept.
        const isGray = parsed.r === parsed.g && parsed.g === parsed.b;
        if (!isGray) {
            setHue(hsv.h);
        }
        setSaturation(hsv.s);
        setValue(hsv.v);
        setAlpha(parsed.a);
    };

    const syncFromExternalValue = (nextValue: string) => {
        loadColor(nextValue);
        if (!untrack(hexEditing)) {
            setHexDraft(nextValue);
        }
    };

    // Keep the hex field in sync with the color state when the change originates
    // from elsewhere (sliders, SV picker, palette), but never while the user is
    // actively typing in the field.
    createEffect(() => {
        const nextValue = props.value;
        if (nextValue === lastSyncedExternalValue) return;
        lastSyncedExternalValue = nextValue;
        syncFromExternalValue(nextValue);
    });

    createEffect(() => {
        const color = currentColor();
        if (!hexEditing()) {
            setHexDraft(color);
        }
    });

    const handleHexInput = (raw: string) => {
        setHexEditing(true);
        setHexDraft(raw);
        if (isValidHex(raw)) {
            loadColor(raw);
        }
    };

    const handleSvPick = (event: MouseEvent) => {
        if (!svPickerRef) return;
        const rect = svPickerRef.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        setHexEditing(false);
        const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
        const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
        setSaturation(x / rect.width);
        setValue(1 - y / rect.height);
    };

    const handleHuePick = (event: MouseEvent) => {
        if (!hueSliderRef) return;
        const rect = hueSliderRef.getBoundingClientRect();
        if (rect.width <= 0) return;
        setHexEditing(false);
        const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
        setHue((x / rect.width) * 360);
    };

    const handleAlphaPick = (event: MouseEvent) => {
        if (!alphaSliderRef) return;
        const rect = alphaSliderRef.getBoundingClientRect();
        setHexEditing(false);
        const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
        setAlpha(rect.width <= 0 ? alpha() : x / rect.width);
    };

    const handleApply = () => {
        props.onChange(currentColor());
        props.onClose();
    };

    const handleAddToPalette = () => {
        if (props.onAddToPalette) {
            props.onAddToPalette(currentColor());
        }
    };

    // Copy the current color as HEX (#RRGGBB[AA]) or as an rgb()/rgba() string.
    const copyText = (text: string) => {
        const clipboard = navigator.clipboard;
        if (!clipboard?.writeText) return;
        // Clipboard permission can be denied outside a user gesture. Handle the
        // rejection locally so it never becomes an unhandled promise rejection.
        void clipboard.writeText(text).catch(() => undefined);
    };

    const handleCopyHex = () => copyText(currentColor());

    const handleCopyRgb = () => {
        const rgb = hsvToRgb(hue(), saturation(), value());
        const a = alpha();
        const text = a < 1
            ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.round(a * 100) / 100})`
            : `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        copyText(text);
    };

    const handleRemoveSelectedPalette = () => {
        const color = selectedPaletteColor();
        if (color && props.onRemoveFromPalette) {
            props.onRemoveFromPalette(color);
            setSelectedPaletteColor(null);
        }
    };

    const isRemovablePaletteColor = (color: string) => {
        if (!props.onRemoveFromPalette) return false;
        return !!color;
    };

    const handlePickFromScreen = () => {
        if (props.onPickFromScreen) {
            props.onPickFromScreen();
        }
    };

    const alphaSliderBackground = () => {
        const rgb = hsvToRgb(hue(), saturation(), value());
        return `linear-gradient(to right, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0), rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)), repeating-conic-gradient(#999 0% 25%, #ddd 0% 50%)`;
    };

    onMount(() => {
        const previousFocus = document.activeElement;
        panelRef?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
        onCleanup(() => {
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
        });
        let svDragging = false;
        let hueDragging = false;
        let alphaDragging = false;

        const onMouseMove = (event: MouseEvent) => {
            if (svDragging) handleSvPick(event);
            if (hueDragging) handleHuePick(event);
            if (alphaDragging) handleAlphaPick(event);
        };

        const onMouseUp = () => {
            svDragging = false;
            hueDragging = false;
            alphaDragging = false;
        };
        const onSvMouseDown = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            svDragging = true;
            handleSvPick(event);
        };
        const onHueMouseDown = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            hueDragging = true;
            handleHuePick(event);
        };
        const onAlphaMouseDown = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            alphaDragging = true;
            handleAlphaPick(event);
        };

        const svPicker = svPickerRef;
        const hueSlider = hueSliderRef;
        const alphaSlider = alphaSliderRef;
        svPicker?.addEventListener("mousedown", onSvMouseDown);
        hueSlider?.addEventListener("mousedown", onHueMouseDown);
        alphaSlider?.addEventListener("mousedown", onAlphaMouseDown);

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        // Solid ignores a value returned from onMount, so the window listeners
        // have to be released through onCleanup or they outlive the picker.
        onCleanup(() => {
            svPicker?.removeEventListener("mousedown", onSvMouseDown);
            hueSlider?.removeEventListener("mousedown", onHueMouseDown);
            alphaSlider?.removeEventListener("mousedown", onAlphaMouseDown);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        });
    });

    // Register the picker's screen rect with the Tauri backend so the OS-level
    // click-through window routes cursor events to the picker. Without this the
    // picker area stays click-through and pointer events pass through the window.
    onMount(() => {
        let rectSyncRaf: number | null = null;
        let lastSyncedRect: { x: number; y: number; width: number; height: number } | null = null;
        const syncRect = () => {
            if (rectSyncRaf !== null) return;
            rectSyncRaf = window.requestAnimationFrame(() => {
                rectSyncRaf = null;
                if (!panelRef) return;
                const rect = panelRef.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                if (panelHeight() !== rect.height) {
                    setPanelHeight(rect.height);
                    // Height changes can move the panel at a screen edge; register after relocation.
                    syncRect();
                    return;
                }
                const nextRect = {
                    x: rect.left,
                    y: rect.top,
                    width: rect.width,
                    height: rect.height,
                };
                if (
                    lastSyncedRect &&
                    Math.abs(lastSyncedRect.x - nextRect.x) < 0.5 &&
                    Math.abs(lastSyncedRect.y - nextRect.y) < 0.5 &&
                    Math.abs(lastSyncedRect.width - nextRect.width) < 0.5 &&
                    Math.abs(lastSyncedRect.height - nextRect.height) < 0.5
                ) {
                    return;
                }
                lastSyncedRect = nextRect;
                addOrUpdateRect({
                    id: COLOR_PICKER_RECT_ID,
                    ...nextRect,
                    name: COLOR_PICKER_RECT_NAME,
                });
                void syncService.updateBackendRects();
            });
        };

        // Sync after layout settles so getBoundingClientRect reflects final position.
        syncRect();
        const onResize = () => {
            setViewport({ width: window.innerWidth, height: window.innerHeight });
            syncRect();
        };
        window.addEventListener("resize", onResize);

        let observer: ResizeObserver | undefined;
        if (typeof ResizeObserver !== "undefined" && panelRef) {
            observer = new ResizeObserver(syncRect);
            observer.observe(panelRef);
        }

        onCleanup(() => {
            if (rectSyncRaf !== null) {
                window.cancelAnimationFrame(rectSyncRaf);
            }
            observer?.disconnect();
            window.removeEventListener("resize", onResize);
            removeRect(COLOR_PICKER_RECT_ID);
            void syncService.updateBackendRects();
        });
    });

    const hueGradient = () => `hsl(${hue()}, 100%, 50%)`;

    const pickerStyle = () => {
        if (!props.anchorRect) {
            return {};
        }
        const viewportWidth = viewport().width;
        const viewportHeight = viewport().height;
        const PICKER_WIDTH = Math.min(248, viewportWidth - 16);
        // Use the panel's real height once mounted; fall back to a generous
        // estimate that covers SV picker + hue + alpha + palette + preview + buttons.
        const PICKER_HEIGHT = Math.min(
            panelHeight(),
            viewportHeight - 16,
        );

        // 优先显示在按钮右侧
        let left = props.anchorRect.x + props.anchorRect.width + 8;
        let top = props.anchorRect.y;

        // 如果右侧空间不够，显示在左侧
        if (left + PICKER_WIDTH > viewportWidth) {
            left = props.anchorRect.x - PICKER_WIDTH - 8;
        }

        // 如果左侧也不够，居中显示在按钮上方或下方
        if (left < 0) {
            left = props.anchorRect.x + props.anchorRect.width / 2 - PICKER_WIDTH / 2;

            // 检查是否显示在下方
            if (props.anchorRect.y + props.anchorRect.height + PICKER_HEIGHT + 8 < viewportHeight) {
                top = props.anchorRect.y + props.anchorRect.height + 8;
            } else {
                top = props.anchorRect.y - PICKER_HEIGHT - 8;
            }
        }

        // 确保不超出视口
        left = Math.max(8, Math.min(left, viewportWidth - PICKER_WIDTH - 8));
        top = Math.max(8, Math.min(top, viewportHeight - PICKER_HEIGHT - 8));

        return {
            position: "fixed" as const,
            left: `${left}px`,
            top: `${top}px`,
        };
    };

    return (
        <div class="fixed inset-0 z-[10001] flex items-center justify-center" onClick={() => props.onClose()}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); props.onClose(); } }}
            onPointerDown={(event) => event.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <div ref={(element) => { panelRef = element; }} class="otter-color-picker-panel" role="dialog" aria-label="颜色选择器"
                style={{ ...pickerStyle() }} onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
                <div ref={(element) => { svPickerRef = element; }} class="otter-color-picker-sv" aria-label="饱和度与明度"
                    style={{ background: "linear-gradient(to bottom, transparent, black), linear-gradient(to right, white, " + hueGradient() + ")" }}>
                    <div class="otter-color-picker-sv-handle" style={{ left: saturation() * 100 + "%", top: (1 - value()) * 100 + "%" }} />
                </div>
                <div ref={(element) => { hueSliderRef = element; }} class="otter-color-picker-track otter-color-picker-hue" aria-label="色相">
                    <div class="otter-color-picker-track-handle" style={{ left: hue() / 360 * 100 + "%" }} />
                </div>
                <div ref={(element) => { alphaSliderRef = element; }} data-alpha-slider class="otter-color-picker-track otter-color-picker-alpha" aria-label="透明度"
                    style={{ "background-image": alphaSliderBackground() }}>
                    <div class="otter-color-picker-track-handle" style={{ left: alpha() * 100 + "%" }} />
                </div>
                <div class="otter-color-picker-values">
                    <button type="button" class="otter-color-picker-preview" aria-label="复制当前颜色 HEX" title="复制 HEX；右键复制 RGB"
                        onClick={handleCopyHex} onContextMenu={(event) => { event.preventDefault(); handleCopyRgb(); }}>
                        <span style={{ background: currentColor() }} />
                    </button>
                    <button type="button" class="otter-color-picker-eyedropper" aria-label="屏幕取色" title="屏幕取色"
                        disabled={!props.onPickFromScreen} onClick={handlePickFromScreen}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="m15 4 5 5m-7-3 5 5M4 20l1-5L16 4a2.8 2.8 0 0 1 4 4L9 19Z" />
                        </svg>
                    </button>
                    <input type="text" class="otter-color-picker-hex" aria-label="HEX 颜色" placeholder="#RRGGBB 或 #RRGGBBAA"
                        value={hexDraft()} onFocus={() => setHexEditing(true)}
                        onBlur={() => { setHexEditing(false); setHexDraft(currentColor()); }}
                        onInput={(event) => handleHexInput(event.currentTarget.value)} />
                    <label class="otter-color-picker-percent">
                        <input type="number" aria-label="不透明度百分比" min="0" max="100" value={Math.round(alpha() * 100)}
                            onInput={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next)) setAlpha(Math.max(0, Math.min(100, next)) / 100); }} />
                        <span>%</span>
                    </label>
                </div>
                <div class="otter-color-picker-palette" role="group" aria-label="调色板" tabIndex={0}
                    onWheel={(event) => event.stopPropagation()}>
                    <Show when={props.onAddToPalette}><button type="button" class="otter-color-picker-palette-add" aria-label="添加到调色板" title="添加到调色板" onClick={handleAddToPalette}>+</button></Show>
                    <For each={props.palette}>{(paletteColor) => {
                        const normalizedColor = normalizeHexColor(paletteColor);
                        const isTransparent = normalizedColor === "transparent";
                        const displayColor = isTransparent ? "transparent" : normalizedColor ?? "#ff0000";
                        return <div class="otter-color-picker-palette-item"><button type="button" class="otter-color-picker-swatch" title={isTransparent ? "透明" : paletteColor}
                            aria-label={isTransparent ? "透明" : paletteColor} aria-pressed={selectedPaletteColor() === paletteColor}
                            onClick={() => { setSelectedPaletteColor(paletteColor); if (isTransparent) setAlpha(0); else loadColor(displayColor); }}
                            onContextMenu={(event) => { event.preventDefault(); if (isRemovablePaletteColor(paletteColor)) { setSelectedPaletteColor(paletteColor); handleRemoveSelectedPalette(); } }}
                            onKeyDown={(event) => { if ((event.key === "Delete" || event.key === "Backspace") && isRemovablePaletteColor(paletteColor)) { event.preventDefault(); event.stopPropagation(); setSelectedPaletteColor(paletteColor); handleRemoveSelectedPalette(); } }}>
                            <span style={{ background: displayColor }} />
                        </button>
                            <Show when={isRemovablePaletteColor(paletteColor)}>
                                <button type="button" class="otter-color-picker-swatch-remove" aria-label={"删除颜色 " + paletteColor} title="删除颜色"
                                    onClick={(event) => { event.stopPropagation(); setSelectedPaletteColor(paletteColor); handleRemoveSelectedPalette(); }}>
                                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m3.5 3.5 5 5m0-5-5 5" /></svg>
                                </button>
                            </Show>
                        </div>;
                    }}</For>
                </div>
                <div class="otter-color-picker-actions">
                    <button type="button" class="otter-color-picker-cancel" aria-label="取消" onClick={() => props.onClose()}>取消</button>
                    <button type="button" class="otter-color-picker-apply" onClick={handleApply}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
                        <span>应用</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
