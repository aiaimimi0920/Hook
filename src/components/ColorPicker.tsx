import { Component, createSignal, createEffect, onMount, onCleanup, For, Show, untrack } from "solid-js";

import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { syncService } from "../services/syncService";
import { hexToRgb, hsvToRgb, normalizeHexColor, rgbToHex, rgbToHsv } from "./ColorPicker/colorMath";

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
        setHexDraft(raw);
        if (isValidHex(raw)) {
            loadColor(raw);
        }
    };

    const handleSvPick = (event: MouseEvent) => {
        if (!svPickerRef) return;
        const rect = svPickerRef.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
        const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
        setSaturation(x / rect.width);
        setValue(1 - y / rect.height);
    };

    const handleHuePick = (event: MouseEvent) => {
        if (!hueSliderRef) return;
        const rect = hueSliderRef.getBoundingClientRect();
        if (rect.width <= 0) return;
        const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
        setHue((x / rect.width) * 360);
    };

    const handleAlphaPick = (event: MouseEvent) => {
        if (!alphaSliderRef) return;
        const rect = alphaSliderRef.getBoundingClientRect();
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
        return `linear-gradient(to right, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0), rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)), linear-gradient(45deg, #9ca3af 25%, transparent 25%), linear-gradient(-45deg, #9ca3af 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #9ca3af 75%), linear-gradient(-45deg, transparent 75%, #9ca3af 75%)`;
    };

    onMount(() => {
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
            removeRect(COLOR_PICKER_RECT_ID);
            void syncService.updateBackendRects();
        });
    });

    const hueGradient = () => `hsl(${hue()}, 100%, 50%)`;

    const pickerStyle = () => {
        if (!props.anchorRect) {
            return {};
        }
        const PICKER_WIDTH = 320;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        // Use the panel's real height once mounted; fall back to a generous
        // estimate that covers SV picker + hue + alpha + palette + preview + buttons.
        const PICKER_HEIGHT = Math.min(
            panelRef?.getBoundingClientRect().height || 480,
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
        <div
            class="fixed inset-0 z-[10001]"
            onClick={() => props.onClose()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div
                ref={panelRef}
                class="hook-terminal-shell hook-terminal-shell--strong overflow-y-auto p-4"
                style={{ width: "320px", "max-height": "calc(100vh - 16px)", ...pickerStyle() }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div class="mb-3 flex items-center justify-between">
                    <span class="text-sm font-semibold">颜色选择器</span>
                    <button
                        class="hook-toolbar-button"
                        onClick={() => props.onClose()}
                    >
                        ✕
                    </button>
                </div>

                <div
                    ref={svPickerRef}
                    class="hook-color-picker__field relative mb-3 h-48 cursor-crosshair"
                    style={{
                        background: `linear-gradient(to bottom, transparent, black), linear-gradient(to right, white, ${hueGradient()})`,
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <div
                        class="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 border-white bg-black/20"
                        style={{
                            left: `${saturation() * 100}%`,
                            top: `${(1 - value()) * 100}%`,
                            "pointer-events": "none",
                        }}
                    />
                </div>

                <div
                    ref={hueSliderRef}
                    class="hook-color-picker__field relative mb-3 h-4 cursor-pointer"
                    style={{
                        background: "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <div
                        class="absolute h-6 w-2 -translate-x-1/2 -translate-y-1/2 border-2 border-white bg-black/30"
                        style={{
                            left: `${(hue() / 360) * 100}%`,
                            top: "50%",
                            "pointer-events": "none",
                        }}
                    />
                </div>

                <div class="mb-3 flex items-center gap-2">
                    <span class="hook-param-label text-sm">透明度</span>
                    <div
                        ref={alphaSliderRef}
                        data-alpha-slider
                        class="hook-color-picker__field relative h-4 flex-1 cursor-pointer"
                        style={{
                            background: alphaSliderBackground(),
                            "background-size": "100% 100%, 8px 8px, 8px 8px, 8px 8px, 8px 8px",
                            "background-position": "0 0, 0 0, 0 4px, 4px -4px, -4px 0px",
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div
                            class="absolute h-6 w-2 -translate-x-1/2 -translate-y-1/2 border-2 border-white bg-black/30"
                            style={{
                                left: `${alpha() * 100}%`,
                                top: "50%",
                                "pointer-events": "none",
                            }}
                        />
                    </div>
                    <span class="hook-param-value text-sm">{Math.round(alpha() * 100)}%</span>
                </div>

                <Show when={props.palette && props.palette.length > 0}>
                    <div class="mb-3">
                        <div class="mb-1 flex h-6 items-center justify-between">
                            <span class="hook-terminal-caption text-xs">调色板</span>
                            <button
                                class="hook-terminal-btn hook-terminal-btn--danger px-2 py-0.5 text-xs"
                                classList={{
                                    invisible: !(selectedPaletteColor() && isRemovablePaletteColor(selectedPaletteColor()!)),
                                }}
                                onClick={handleRemoveSelectedPalette}
                                onPointerDown={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                title="从调色板删除选中颜色"
                            >
                                删除
                            </button>
                        </div>
                        <div class="flex flex-wrap gap-1">
                            <For each={props.palette}>
                                {(paletteColor) => {
                                    const normalizedColor = normalizeHexColor(paletteColor);
                                    const isTransparent = normalizedColor === "transparent";
                                    const displayColor = isTransparent ? "transparent" : normalizedColor ?? "#ff0000";
                                    return (
                                        <button
                                            class="hook-color-swatch h-6 w-6 overflow-hidden"
                                            classList={{
                                                "hook-color-swatch--selected": selectedPaletteColor() === paletteColor,
                                            }}
                                            style={{
                                                background: `linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)`,
                                                "background-size": "8px 8px",
                                                "background-position": "0 0, 0 4px, 4px -4px, -4px 0px",
                                            }}
                                            title={isTransparent ? "透明" : paletteColor}
                                            onClick={() => {
                                                setSelectedPaletteColor(paletteColor);
                                                if (isTransparent) {
                                                    // Fully-transparent swatch: keep the hue but drop alpha to 0
                                                    // so the current color actually becomes transparent.
                                                    setAlpha(0);
                                                } else {
                                                    loadColor(displayColor);
                                                }
                                            }}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onMouseDown={(e) => e.stopPropagation()}
                                        >
                                            <span
                                                class="block h-full w-full"
                                                style={{ background: displayColor }}
                                            />
                                        </button>
                                    );
                                }}
                            </For>
                        </div>
                    </div>
                </Show>

                <div class="hook-terminal-caption mb-1 text-xs">当前颜色（可编辑颜色码）</div>
                <div class="flex items-center gap-3">
                    <div
                        class="hook-color-picker__preview h-12 w-12 flex-shrink-0"
                        style={{
                            background: `linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)`,
                            "background-size": "8px 8px",
                            "background-position": "0 0, 0 4px, 4px -4px, -4px 0px",
                        }}
                    >
                        <div
                            class="h-full w-full"
                            style={{ background: currentColor() }}
                        />
                    </div>
                    <div class="flex-1">
                        <input
                            type="text"
                            class="hook-terminal-input w-full px-2 py-1 font-mono text-sm"
                            placeholder="#RRGGBB 或 #RRGGBBAA"
                            value={hexDraft()}
                            onFocus={() => setHexEditing(true)}
                            onBlur={() => {
                                setHexEditing(false);
                                setHexDraft(currentColor());
                            }}
                            onInput={(e) => handleHexInput(e.currentTarget.value)}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                        />
                    </div>
                </div>

                <div class="hook-color-picker__footer sticky bottom-0 mt-3 flex flex-wrap items-center gap-2 pt-2">
                    <button
                        class="hook-terminal-btn hook-terminal-btn--success px-3 py-1 text-sm"
                        onClick={handleApply}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        title="将当前颜色应用到配置"
                    >
                        应用颜色
                    </button>
                    <Show when={props.onAddToPalette}>
                        <button
                            class="hook-terminal-btn px-3 py-1 text-sm"
                            onClick={handleAddToPalette}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            title="将当前颜色存入永久调色板"
                        >
                            添加到调色板
                        </button>
                    </Show>
                    <Show when={props.onPickFromScreen}>
                        <button
                            class="hook-terminal-btn px-3 py-1 text-sm"
                            onClick={handlePickFromScreen}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            title="从屏幕取色"
                        >
                            屏幕取色
                        </button>
                    </Show>
                    <button
                        class="hook-terminal-btn px-3 py-1 text-sm"
                        onClick={handleCopyHex}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        title="复制当前颜色的 HEX 颜色码"
                    >
                        复制HEX
                    </button>
                    <button
                        class="hook-terminal-btn px-3 py-1 text-sm"
                        onClick={handleCopyRgb}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        title="复制当前颜色的 RGB 值"
                    >
                        复制RGB
                    </button>
                </div>
            </div>
        </div>
    );
};
