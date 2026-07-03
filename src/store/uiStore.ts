import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import {
    addStickerPaletteColor,
    createDefaultStickerColorState,
    createDefaultStickerToolSettings,
    normalizeStickerPaletteColor,
    removeStickerPaletteColor,
} from "../services/stickerEditing";
import {
    createEmptyStickerHistory,
    pushStickerHistorySnapshot,
    redoStickerHistorySnapshot,
    undoStickerHistorySnapshot,
    type StickerEditHistory,
    type StickerEditSnapshot,
} from "../services/stickerHistory";
import type {
    StickerAnnotationState,
    StickerCaptureMeta,
    StickerColorState,
    StickerEditingDomain,
    StickerImageEditState,
    StickerCanvasTool,
    StickerCreateTool,
    StickerToolSettings,
    StickerToolMode,
    StickerTransformMode,
} from "../types/stickerEditing";
import type { CaptureRect, LongCaptureAxis, LongCaptureDirection } from "../services/captureState";
import {
    addColorToHistory,
    addScreenshotToHistory,
    createEmptyHistoryState,
    removeScreenshotFromHistory,
    type HistoryState,
    type ScreenshotHistoryEntry,
} from "../services/historyModel";
import { api } from "../services/api";
import { applyStickerToolSettingsPatch, normalizeStickerToolSettings } from "../services/toolSettings";

// Global Selection State
export const [selectedStickerId, setSelectedStickerId] = createSignal<string | null>(null);

// Multi-Select State (Phase 3)
export const [selectedUnitIds, setSelectedUnitIds] = createStore<string[]>([]);

export const selectionActions = {
    add: (id: string) => {
        setSelectedUnitIds(prev => prev.includes(id) ? prev : [...prev, id]);
        // Keep single-select for backward compat / primary target
        setSelectedStickerId(id);
    },
    remove: (id: string) => {
        setSelectedUnitIds(prev => prev.filter(uid => uid !== id));
        if (selectedStickerId() === id) {
             setSelectedStickerId(null);
        }
    },
    toggle: (id: string) => {
        if (selectedUnitIds.includes(id)) {
            selectionActions.remove(id);
        } else {
            selectionActions.add(id);
        }
    },
    clear: () => {
        setSelectedUnitIds([]);
        setSelectedStickerId(null);
    },
    set: (ids: string[]) => {
        setSelectedUnitIds(ids);
        if (ids.length === 1) setSelectedStickerId(ids[0]);
        else if (ids.length === 0) setSelectedStickerId(null);
        // If multiple, maybe keep the last one as "primary" or "focused"?
        // For now, let's say the last added is the "active" one for params panel etc.
        if (ids.length > 0) setSelectedStickerId(ids[ids.length - 1]);
    },
    isSelected: (id: string) => selectedUnitIds.includes(id)
};

// Global Dragging State
export const [draggingStickerId, setDraggingStickerId] = createSignal<string | null>(null);
// Legacy Single Drag (Keep for conflict avoidance during transition, or deprecate?)
// We will use this for the *Primary* dragged unit for snapping logic
// Multi-Drag Positions (Map ID -> {x, y})
export const [multiDragPositions, setMultiDragPositions] = createSignal<Record<string, {x: number, y: number}> | null>(null);
// Capture Mode (Screenshot)
export const [isSelecting, setIsSelecting] = createSignal(false);
export const [captureMode, setCaptureMode] = createSignal<"region" | "long-vertical">("region");
export const [longCaptureSession, setLongCaptureSession] = createSignal<{
    active: boolean;
    rect: CaptureRect;
    frameCount: number;
    duplicateCount?: number;
    status: "capturing" | "stitching";
    axis?: LongCaptureAxis;
    direction?: LongCaptureDirection;
    confidence?: number;
    lastMessage?: string;
} | null>(null);
// Box Selection (Multi-Select)
export const [isBoxSelecting, setIsBoxSelecting] = createSignal(false);

export const [startPos, setStartPos] = createSignal<{x: number, y: number} | null>(null);
export const [selectionRect, setSelectionRect] = createSignal<{x: number, y: number, w: number, h: number} | null>(null);
export const [preciseRect, setPreciseRect] = createSignal<{x: number, y: number, w: number, h: number} | null>(null);
// Clean View Mode (Hides UI overlay)
export const [isCleanView, setIsCleanView] = createSignal(false);
export const [activeStickerEditTargetId, setActiveStickerEditTargetId] = createSignal<string | null>(null);
export const [selectedStickerAnnotationId, setSelectedStickerAnnotationId] = createSignal<string | null>(null);
export const [selectedStickerAnnotationIds, setSelectedStickerAnnotationIds] = createStore<string[]>([]);
export const [activeStickerGroupId, setActiveStickerGroupId] = createSignal<string | null>(null);
export const [stickerEditCancelToken, setStickerEditCancelToken] = createSignal(0);
export const [stickerToolSettings, setStickerToolSettings] = createStore<StickerToolSettings>(
    createDefaultStickerToolSettings(),
);
export const [installedStickerFonts, setInstalledStickerFonts] = createSignal<string[]>([]);
export const [stickerColorPickerReturnMode, setStickerColorPickerReturnMode] = createSignal<StickerCreateTool | null>(null);
export const [stickerColorState, setStickerColorState] = createStore<StickerColorState>(
    createDefaultStickerColorState(),
);
export const [stickerEditHistories, setStickerEditHistories] = createStore<Record<string, StickerEditHistory>>({});

// Color + Screenshot History (persisted to disk via save_history/load_history)
export const [historyState, setHistoryState] = createStore<HistoryState>(createEmptyHistoryState());
export const [isHistoryPanelOpen, setIsHistoryPanelOpen] = createSignal(false);

// Force Reactivity Tick for Layout (e.g. Fit Frame)
export const [layoutTick, setLayoutTick] = createSignal(0);
// export const [isCropping, setIsCropping] = createSignal(false);



// Linking State
export const [linkingState, setLinkingState] = createSignal<{
    isLinking: boolean,
    sourceUnitId: string | null,
    sourceParamId: string | null,
    startX: number,
    startY: number
}>({
    isLinking: false,
    sourceUnitId: null,
    sourceParamId: null,
    startX: 0,
    startY: 0
});

export const [hoveringLink, setHoveringLink] = createSignal<{sourceUnitId: string | null, targetUnitId: string | null}>({
    sourceUnitId: null,
    targetUnitId: null
});

// Mouse Tracking
export const [mousePos, setMousePos] = createSignal({ x: 0, y: 0 });

export const [globalAddNodeMenu, setGlobalAddNodeMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
}>({
    visible: false,
    x: 0,
    y: 0,
});

export interface EnhancementNotice {
    feature: "OCR" | "Translation";
    title: string;
    message: string;
}

export const [enhancementNotices, setEnhancementNotices] = createStore<Record<string, EnhancementNotice | undefined>>({});

// Unit-Specific UI State (e.g. Panels open/close)
// Key: Unit ID
export const [unitUiState, setUnitUiState] = createStore<Record<string, { showActions: boolean; showParams: boolean }>>({});


// Clipboard State (Restored from Legacy)
export interface ClipboardData {
    // Legacy Sticker Data
    src: string;
    w: number;
    h: number;
    minified?: boolean;
    savedRect?: { x: number, y: number, w: number, h: number };
    cropOffset?: { x: number, y: number };
    opacityNormal?: number;
    opacityMini?: number;
    rasterizedAnnotationLayerSrc?: string;
    annotationState?: StickerAnnotationState;
    imageEditState?: StickerImageEditState;
    groupId?: string;
    captureMeta?: StickerCaptureMeta;

    // Cascade Logic
    originalId: string;
    originalX: number;
    originalY: number;
    nextCascadeX: number;
    nextCascadeY: number;

    // Copy Context
    offsetX: number;
    offsetY: number;
}
export const [clipboard, setClipboard] = createSignal<ClipboardData | null>(null);

// Persist the current history store to disk. Failures are non-fatal: history
// is a convenience cache, not critical state.
let persistHistoryTimer: ReturnType<typeof setTimeout> | null = null;
let persistToolSettingsTimer: ReturnType<typeof setTimeout> | null = null;
const persistHistory = async () => {
    if (persistHistoryTimer) clearTimeout(persistHistoryTimer);
    persistHistoryTimer = setTimeout(() => {
        void (async () => {
            try {
                await api.saveHistory(
                    [...historyState.colors],
                    [...historyState.screenshots],
                );
            } catch (error) {
                console.error("Failed to persist history", error);
            }
        })();
    }, 250);
};

const persistToolSettings = async () => {
    if (persistToolSettingsTimer) clearTimeout(persistToolSettingsTimer);
    persistToolSettingsTimer = setTimeout(() => {
        void (async () => {
            try {
                await api.saveToolSettings({ ...stickerToolSettings });
            } catch (error) {
                console.error("Failed to persist sticker tool settings", error);
            }
        })();
    }, 250);
};

export const uiActions = {

    // Helper to toggle actions menu safely
    toggleActions: (id: string) => {
        setUnitUiState(id, (prev) => {
            const current = prev?.showActions ?? false;
            return { ...prev, showActions: !current };
        });
    },
    // Helper to toggle params panel safely
    toggleParams: (id: string) => {
        setUnitUiState(id, (prev) => {
            const current = prev?.showParams ?? false;
            return { ...prev, showParams: !current };
        });
    },
    closeActions: (id: string) => {
        setUnitUiState(id, (prev) => ({
            ...prev,
            showActions: false,
        }));
    },
    openParams: (id: string) => {
        setUnitUiState(id, (prev) => ({
            ...prev,
            showParams: true,
        }));
    },
    closePopups: (id: string) => {
        setUnitUiState(id, (prev) => ({
            ...prev,
            showActions: false,
            showParams: false,
        }));
    },
    closeAllPopups: () => {
        // Implementation might need iteration if we want to close ALL
        // For now, consumers can manually set state or we iterate keys
    },
    showEnhancementNotice: (unitId: string, notice: EnhancementNotice) => {
        setEnhancementNotices(unitId, notice);
    },
    dismissEnhancementNotice: (unitId: string) => {
        setEnhancementNotices(unitId, undefined);
    },
    setStickerEditMode: (mode: StickerToolSettings["mode"]) => {
        setStickerColorPickerReturnMode(null);
        if (mode === "select" || mode === "move" || mode === "rotate" || mode === "scale") {
            setStickerToolSettings((prev) =>
                applyStickerToolSettingsPatch(prev, {
                    domain: "existing",
                    mode,
                    transformMode: mode,
                }),
            );
            return;
        }

        setStickerToolSettings((prev) =>
            applyStickerToolSettingsPatch(prev, {
                domain: mode === "crop" || mode === "content-eraser" ? "sticker" : "create",
                mode,
                activeCanvasTool:
                    mode === "crop" || mode === "content-eraser"
                        ? mode
                        : prev.activeCanvasTool,
                activeTool:
                    mode === "idle" || mode === "crop" || mode === "content-eraser"
                        ? prev.activeTool
                        : mode,
            }),
        );
    },
    setStickerTransformMode: (transformMode: StickerTransformMode) => {
        setStickerColorPickerReturnMode(null);
        setStickerToolSettings((prev) =>
            applyStickerToolSettingsPatch(prev, {
                domain: "existing",
                mode: transformMode,
                transformMode,
            }),
        );
        void persistToolSettings();
    },
    setStickerEditingDomain: (domain: StickerEditingDomain) => {
        setStickerColorPickerReturnMode(null);
        setStickerToolSettings((prev) =>
            applyStickerToolSettingsPatch(prev, {
                domain,
                activeCanvasTool: domain === "sticker" ? "idle" : prev.activeCanvasTool,
                mode:
                    domain === "existing"
                        ? prev.transformMode
                        : domain === "sticker"
                          ? "idle"
                          : prev.activeTool,
            }),
        );
        void persistToolSettings();
    },
    setStickerActiveTool: (activeTool: StickerCreateTool) => {
        setStickerColorPickerReturnMode(null);
        setStickerToolSettings((prev) =>
            applyStickerToolSettingsPatch(prev, {
                domain: "create",
                mode: activeTool,
                activeTool,
            }),
        );
        void persistToolSettings();
    },
    setStickerCanvasTool: (activeCanvasTool: StickerCanvasTool) => {
        setStickerColorPickerReturnMode(null);
        setStickerToolSettings((prev) =>
            applyStickerToolSettingsPatch(prev, {
                domain: "sticker",
                mode: activeCanvasTool,
                activeCanvasTool,
            }),
        );
        void persistToolSettings();
    },
    beginStickerScreenColorPick: (returnMode?: StickerCreateTool | null) => {
        setStickerColorPickerReturnMode(returnMode && returnMode !== "color-picker" ? returnMode : null);
        setStickerToolSettings((prev) =>
            applyStickerToolSettingsPatch(prev, {
                mode: "color-picker",
                activeTool: "color-picker",
            }),
        );
    },
    consumeStickerColorPickerReturnMode: () => {
        const mode = stickerColorPickerReturnMode();
        setStickerColorPickerReturnMode(null);
        return mode;
    },
    patchStickerToolSettings: (updates: Partial<StickerToolSettings>) => {
        setStickerToolSettings((prev) => applyStickerToolSettingsPatch(prev, updates));
        void persistToolSettings();
    },
    setStickerToolSettings: (updates: Partial<StickerToolSettings>) => {
        setStickerToolSettings((prev) => applyStickerToolSettingsPatch(prev, updates));
        void persistToolSettings();
    },
    setStickerActiveColor: (color: string) => {
        setStickerColorState("activeColor", color);
    },
    addStickerPaletteColor: (color: string) => {
        const normalized = normalizeStickerPaletteColor(color);
        if (!normalized) return;
        setStickerColorState("palette", (palette) => addStickerPaletteColor(palette, normalized));
    },
    removeStickerPaletteColor: (color: string) => {
        const normalized = normalizeStickerPaletteColor(color);
        if (!normalized) return;
        setStickerColorState("palette", (palette) => removeStickerPaletteColor(palette, normalized));
    },
    setStickerSampledColor: (color: string | undefined) => {
        setStickerColorState("sampledColor", color);
    },
    setStickerSampledRgb: (rgb: { r: number; g: number; b: number } | undefined) => {
        setStickerColorState("sampledRgb", rgb);
    },

    // --- Color + Screenshot history ---
    // Replace the whole history state (used on load from disk).
    setHistoryState: (next: HistoryState) => {
        setHistoryState("colors", next.colors);
        setHistoryState("screenshots", next.screenshots);
    },
    recordColorHistory: (color: { hex: string; rgb: { r: number; g: number; b: number } }) => {
        setHistoryState("colors", (colors) => addColorToHistory(colors, color, Date.now()));
        void persistHistory();
    },
    recordScreenshotHistory: (entry: ScreenshotHistoryEntry) => {
        setHistoryState("screenshots", (screenshots) => addScreenshotToHistory(screenshots, entry));
        void persistHistory();
    },
    removeScreenshotHistory: (id: string) => {
        setHistoryState("screenshots", (screenshots) => removeScreenshotFromHistory(screenshots, id));
        void persistHistory();
    },
    toggleHistoryPanel: () => {
        setIsHistoryPanelOpen((open) => !open);
    },
    setHistoryPanelOpen: (open: boolean) => {
        setIsHistoryPanelOpen(open);
    },

    setActiveStickerEditTarget: (unitId: string | null) => {
        setActiveStickerEditTargetId(unitId);
    },
    showStickerToolbar: (unitId: string) => {
        setActiveStickerEditTargetId(unitId);
        setSelectedStickerAnnotationId(null);
        setSelectedStickerAnnotationIds([]);
        setStickerToolSettings((prev) =>
            applyStickerToolSettingsPatch(prev, {
                mode: "select",
                transformMode: "select",
            }),
        );
    },
    hideStickerToolbar: () => {
        setActiveStickerEditTargetId(null);
        setSelectedStickerAnnotationId(null);
        setSelectedStickerAnnotationIds([]);
        setStickerToolSettings((prev) =>
            applyStickerToolSettingsPatch(prev, {
                mode: "select",
                transformMode: "select",
            }),
        );
        setStickerEditCancelToken((value) => value + 1);
    },
    setSelectedStickerAnnotation: (annotationId: string | null) => {
        setSelectedStickerAnnotationId(annotationId);
        setSelectedStickerAnnotationIds(annotationId ? [annotationId] : []);
    },
    setSelectedStickerAnnotations: (annotationIds: string[]) => {
        const ids = Array.from(new Set(annotationIds));
        setSelectedStickerAnnotationIds(ids);
        setSelectedStickerAnnotationId(ids.length > 0 ? ids[ids.length - 1] : null);
    },
    requestStickerEditCancel: () => {
        setStickerEditCancelToken((value) => value + 1);
    },
    setActiveStickerGroup: (groupId: string | null) => {
        setActiveStickerGroupId(groupId);
    },
    pushStickerHistory: (unitId: string, snapshot: StickerEditSnapshot) => {
        setStickerEditHistories(unitId, (prev) =>
            pushStickerHistorySnapshot(prev || createEmptyStickerHistory(), snapshot),
        );
    },
    undoStickerHistory: (unitId: string, current: StickerEditSnapshot) => {
        const result = undoStickerHistorySnapshot(
            stickerEditHistories[unitId] || createEmptyStickerHistory(),
            current,
        );
        setStickerEditHistories(unitId, result.history);
        return result.snapshot;
    },
    redoStickerHistory: (unitId: string, current: StickerEditSnapshot) => {
        const result = redoStickerHistorySnapshot(
            stickerEditHistories[unitId] || createEmptyStickerHistory(),
            current,
        );
        setStickerEditHistories(unitId, result.history);
        return result.snapshot;
    },
    clearStickerHistory: (unitId: string) => {
        setStickerEditHistories(unitId, undefined!);
    },
};
