import { Component, createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";

import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { syncService } from "../services/syncService";

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

const hexToRgb = (hex: string): { r: number; g: number; b: number; a: number } => {
    if (!hex || typeof hex !== "string") {
        return { r: 255, g: 0, b: 0, a: 1 };
    }
    // Literal "transparent": keep a neutral hue but zero alpha so opening a
    // transparent slot shows a transparent (not opaque-red) starting color.
    if (hex.trim().toLowerCase() === "transparent") {
        return { r: 255, g: 0, b: 0, a: 0 };
    }
    const parseByte = (str: string, fallback: number) => {
        const parsed = parseInt(str, 16);
        return Number.isNaN(parsed) ? fallback : parsed;
    };
    const cleaned = hex.replace("#", "");
    if (cleaned.length === 8) {
        return {
            r: parseByte(cleaned.substring(0, 2), 0),
            g: parseByte(cleaned.substring(2, 4), 0),
            b: parseByte(cleaned.substring(4, 6), 0),
            a: parseByte(cleaned.substring(6, 8), 255) / 255,
        };
    }
    if (cleaned.length === 6) {
        return {
            r: parseByte(cleaned.substring(0, 2), 0),
            g: parseByte(cleaned.substring(2, 4), 0),
            b: parseByte(cleaned.substring(4, 6), 0),
            a: 1,
        };
    }
    return { r: 255, g: 0, b: 0, a: 1 };
};

const rgbToHex = (r: number, g: number, b: number, a: number): string => {
    const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
    if (a < 1) {
        return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a * 255)}`;
    }
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const rgbToHsv = (r: number, g: number, b: number): { h: number; s: number; v: number } => {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
        if (max === rNorm) {
            h = ((gNorm - bNorm) / delta) % 6;
        } else if (max === gNorm) {
            h = (bNorm - rNorm) / delta + 2;
        } else {
            h = (rNorm - gNorm) / delta + 4;
        }
        h = Math.round(h * 60);
        if (h < 0) h += 360;
    }

    const s = max === 0 ? 0 : delta / max;
    const v = max;

    return { h, s, v };
};

const hsvToRgb = (h: number, s: number, v: number): { r: number; g: number; b: number } => {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r = 0, g = 0, b = 0;
    if (h < 60) {
        r = c; g = x; b = 0;
    } else if (h < 120) {
        r = x; g = c; b = 0;
    } else if (h < 180) {
        r = 0; g = c; b = x;
    } else if (h < 240) {
        r = 0; g = x; b = c;
    } else if (h < 300) {
        r = x; g = 0; b = c;
    } else {
        r = c; g = 0; b = x;
    }

    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
    };
};

interface ColorPickerPropsExtended extends ColorPickerProps {
    anchorRect?: { x: number; y: number; width: number; height: number };
}

export const ColorPicker: Component<ColorPickerPropsExtended> = (props) => {
    const initial = hexToRgb(props.value);
    const initialHsv = rgbToHsv(initial.r, initial.g, initial.b);

    const [hue, setHue] = createSignal(initialHsv.h);
    const [saturation, setSaturation] = createSignal(initialHsv.s);
    const [value, setValue] = createSignal(initialHsv.v);
    const [alpha, setAlpha] = createSignal(initial.a);
    const [selectedPaletteColor, setSelectedPaletteColor] = createSignal<string | null>(null);
    // Draft text for the editable hex field. Decoupled from the color state so the
    // user can type partial/intermediate values (e.g. while entering an 8-digit
    // alpha hex) without the field snapping back to a fallback color.
    const [hexDraft, setHexDraft] = createSignal(props.value);
    const [hexEditing, setHexEditing] = createSignal(false);

    let svPickerRef: HTMLDivElement | undefined;
    let hueSliderRef: HTMLDivElement | undefined;
    let panelRef: HTMLDivElement | undefined;

    const currentColor = () => {
        const rgb = hsvToRgb(hue(), saturation(), value());
        return rgbToHex(rgb.r, rgb.g, rgb.b, alpha());
    };

    const isValidHex = (hex: string) => {
        const cleaned = hex.trim().replace(/^#/, "");
        return /^[0-9a-fA-F]{6}$/.test(cleaned) || /^[0-9a-fA-F]{8}$/.test(cleaned);
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

    // Keep the hex field in sync with the color state when the change originates
    // from elsewhere (sliders, SV picker, palette), but never while the user is
    // actively typing in the field.
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
        const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
        const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
        setSaturation(x / rect.width);
        setValue(1 - y / rect.height);
    };

    const handleHuePick = (event: MouseEvent) => {
        if (!hueSliderRef) return;
        const rect = hueSliderRef.getBoundingClientRect();
        const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
        setHue((x / rect.width) * 360);
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
        void navigator.clipboard.writeText(text);
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

    onMount(() => {
        let svDragging = false;
        let hueDragging = false;

        const onMouseMove = (event: MouseEvent) => {
            if (svDragging) handleSvPick(event);
            if (hueDragging) handleHuePick(event);
        };

        const onMouseUp = () => {
            svDragging = false;
            hueDragging = false;
        };

        if (svPickerRef) {
            svPickerRef.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopPropagation();
                svDragging = true;
                handleSvPick(event);
            });
        }

        if (hueSliderRef) {
            hueSliderRef.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopPropagation();
                hueDragging = true;
                handleHuePick(event);
            });
        }

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    });

    // Register the picker's screen rect with the Tauri backend so the OS-level
    // click-through window routes cursor events to the picker. Without this the
    // picker area stays click-through and pointer events pass through the window.
    onMount(() => {
        const syncRect = () => {
            if (!panelRef) return;
            const rect = panelRef.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            addOrUpdateRect({
                id: COLOR_PICKER_RECT_ID,
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height,
                name: COLOR_PICKER_RECT_NAME,
            });
            void syncService.updateBackendRects();
        };

        // Sync after layout settles so getBoundingClientRect reflects final position.
        requestAnimationFrame(syncRect);

        let observer: ResizeObserver | undefined;
        if (typeof ResizeObserver !== "undefined" && panelRef) {
            observer = new ResizeObserver(syncRect);
            observer.observe(panelRef);
        }

        onCleanup(() => {
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
            onClick={props.onClose}
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
                    <span class="text-sm font-semibold text-white">颜色选择器</span>
                    <button
                        class="text-white/60 hover:text-white"
                        onClick={props.onClose}
                    >
                        ✕
                    </button>
                </div>

                <div
                    ref={svPickerRef}
                    class="relative mb-3 h-48 cursor-crosshair border border-white/10"
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
                    class="relative mb-3 h-4 cursor-pointer border border-white/10"
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
                    <span class="text-sm text-white/70">透明度</span>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value={alpha() * 100}
                        class="flex-1"
                        onInput={(e) => setAlpha(parseInt(e.currentTarget.value) / 100)}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                    <span class="text-sm text-white">{Math.round(alpha() * 100)}%</span>
                </div>

                <Show when={props.palette && props.palette.length > 0}>
                    <div class="mb-3">
                        <div class="mb-1 flex h-6 items-center justify-between">
                            <span class="text-xs text-white/50">调色板</span>
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
                                    const isTransparent = !paletteColor || paletteColor.toLowerCase() === "transparent";
                                    return (
                                        <button
                                            class="h-6 w-6 overflow-hidden border hover:border-white/60"
                                            classList={{
                                                "border-white ring-2 ring-white/60": selectedPaletteColor() === paletteColor,
                                                "border-white/20": selectedPaletteColor() !== paletteColor,
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
                                                    loadColor(paletteColor);
                                                }
                                            }}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onMouseDown={(e) => e.stopPropagation()}
                                        >
                                            <span
                                                class="block h-full w-full"
                                                style={{ background: isTransparent ? "transparent" : paletteColor }}
                                            />
                                        </button>
                                    );
                                }}
                            </For>
                        </div>
                    </div>
                </Show>

                <div class="mb-1 text-xs text-white/50">当前颜色（可编辑颜色码）</div>
                <div class="flex items-center gap-3">
                    <div
                        class="h-12 w-12 flex-shrink-0 border border-white/20"
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

                <div class="sticky bottom-0 mt-3 flex flex-wrap items-center gap-2 bg-slate-900 pt-2">
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
