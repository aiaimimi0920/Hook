import { batch, onCleanup } from "solid-js";
import {
    setDraggingStickerId,
    selectedUnitIds,
    setMultiDragPositions
} from "../store/uiStore";
import { graphStore } from "../store/graphStore";
import { syncService } from "../services/syncService";
import { api } from "../services/api";
import { checkDragModifier } from "./useShortcuts";
import {
    beginStickerGpuWarmDrag,
    endStickerGpuWarmDrag,
    isStickerGpuWarm,
} from "../services/stickerGpuWarmPool";
import { getDragFollowerElements } from "../services/dragFollowerRegistry";
import {
    buildDragTargetIndex,
    type DragTargetIndex,
} from "../services/dragTargetIndex";

type DragPosition = { x: number; y: number };
type DragPositionMap = Record<string, DragPosition>;

const LINK_PREVIEW_INTERVAL_MS = 32;
export const DRAG_WATCHDOG_TIMEOUT_MS = 30_000;

type DragFollowerStyle = {
    unitId: string;
    element: HTMLElement;
    transform: string;
    willChange: string;
    transitionProperty: string;
};

type PendingDragPointer = {
    clientX: number;
    clientY: number;
    alignment: boolean;
    cascade: boolean;
};

export function useDraggable() {
    // Snapshot of original positions and direct DOM followers for this hook instance.
    let dragStartPositions: DragPositionMap = {};
    let latestDragPositions: DragPositionMap | null = null;
    let hasMoved = false;
    let clickHandler: ((id: string) => void) | undefined;
    let dragFollowerStyles: DragFollowerStyle[] = [];
    let dragFollowersCollected = false;
    let dragOffset = { x: 0, y: 0 };
    let activeDragId: string | null = null;
    let pendingDragPointer: PendingDragPointer | null = null;
    let dragMoveRafId: number | null = null;
    let hasCommittedDragFrame = false;
    let lastLinkPreviewCommitAt = Number.NEGATIVE_INFINITY;
    let dragRawMoveCount = 0;
    let dragFrameCount = 0;
    let dragLinkPreviewCount = 0;
    let dragLongFrameCount = 0;
    let dragMaxFrameGapMs = 0;
    let dragMaxApplyMs = 0;
    let lastDragFrameAt: number | null = null;
    let gpuWarmDragIds: string[] = [];
    let dragStartedPrewarmed = false;
    let dragTargetIndex: DragTargetIndex | null = null;
    let draggedUnitSize: { w: number; h: number } | null = null;
    let dragWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let lastDragActivityAt = 0;

    const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();

    const collectDragFollowers = () => {
        dragFollowersCollected = true;
        dragFollowerStyles = [];
        for (const { unitId, element } of getDragFollowerElements(Object.keys(dragStartPositions))) {
            dragFollowerStyles.push({
                unitId,
                element,
                transform: element.style.transform,
                willChange: element.style.willChange,
                transitionProperty: element.style.transitionProperty,
            });
        }
    };

    const prepareDragVisualFastPath = () => {
        collectDragFollowers();
        for (const follower of dragFollowerStyles) {
            follower.element.style.willChange = "transform";
            follower.element.style.transitionProperty = "none";
        }
    };

    const applyDragVisualFastPath = (positions: DragPositionMap) => {
        if (!dragFollowersCollected) {
            prepareDragVisualFastPath();
        }

        for (const follower of dragFollowerStyles) {
            const start = dragStartPositions[follower.unitId];
            const position = positions[follower.unitId];
            if (!start || !position) continue;

            follower.element.style.transform = `translate3d(${position.x - start.x}px, ${position.y - start.y}px, 0)`;
            follower.element.style.willChange = "transform";
            follower.element.style.transitionProperty = "none";
        }
    };

    const applyImmediateDragVisual = (snapshot: PendingDragPointer) => {
        if (snapshot.alignment || snapshot.cascade) return;
        const primaryId = activeDragId;
        if (!primaryId) return;
        const primaryStart = dragStartPositions[primaryId];
        if (!primaryStart) return;

        const primaryX = snapshot.clientX - dragOffset.x;
        const primaryY = snapshot.clientY - dragOffset.y;
        const deltaX = primaryX - primaryStart.x;
        const deltaY = primaryY - primaryStart.y;
        const positions: DragPositionMap = {};
        for (const unitId in dragStartPositions) {
            const start = dragStartPositions[unitId];
            positions[unitId] = {
                x: start.x + deltaX,
                y: start.y + deltaY,
            };
        }
        applyDragVisualFastPath(positions);
    };

    const clearDragVisualFastPath = () => {
        for (const follower of dragFollowerStyles) {
            follower.element.style.transform = follower.transform;
            follower.element.style.willChange = follower.willChange;
            follower.element.style.transitionProperty = follower.transitionProperty;
        }
        dragFollowerStyles = [];
        dragFollowersCollected = false;
    };

    const finishGpuWarmDrag = () => {
        const completedIds = gpuWarmDragIds;
        gpuWarmDragIds = [];
        for (const unitId of completedIds) {
            endStickerGpuWarmDrag(unitId);
        }
    };

    const clearDragWatchdog = () => {
        if (dragWatchdogTimer !== null) {
            clearTimeout(dragWatchdogTimer);
            dragWatchdogTimer = null;
        }
    };

    const cancelPendingDragFrame = () => {
        if (dragMoveRafId !== null && typeof window !== "undefined") {
            window.cancelAnimationFrame(dragMoveRafId);
        }
        dragMoveRafId = null;
        pendingDragPointer = null;
    };

    function abortActiveDrag(_reason: "blur" | "hidden" | "pointercancel" | "watchdog" | "restart" | "cleanup") {
        const hadActiveDragState =
            activeDragId !== null ||
            gpuWarmDragIds.length > 0 ||
            dragMoveRafId !== null ||
            pendingDragPointer !== null ||
            dragFollowersCollected;
        clearDragWatchdog();
        lastDragActivityAt = 0;
        if (!hadActiveDragState) return;

        cancelPendingDragFrame();
        clearDragVisualFastPath();
        finishGpuWarmDrag();
        activeDragId = null;
        latestDragPositions = null;
        dragStartPositions = {};
        dragTargetIndex = null;
        draggedUnitSize = null;
        clickHandler = undefined;
        hasMoved = false;
        hasCommittedDragFrame = false;
        batch(() => {
            setDraggingStickerId(null);
            setMultiDragPositions(null);
        });
    }

    const scheduleDragWatchdogCheck = (delay: number) => {
        if (!activeDragId) return;
        dragWatchdogTimer = setTimeout(() => {
            dragWatchdogTimer = null;
            if (!activeDragId) return;

            const inactiveFor = Date.now() - lastDragActivityAt;
            if (inactiveFor >= DRAG_WATCHDOG_TIMEOUT_MS) {
                abortActiveDrag("watchdog");
                return;
            }
            scheduleDragWatchdogCheck(DRAG_WATCHDOG_TIMEOUT_MS - inactiveFor);
        }, delay);
    };

    const startDragWatchdog = () => {
        clearDragWatchdog();
        lastDragActivityAt = Date.now();
        scheduleDragWatchdogCheck(DRAG_WATCHDOG_TIMEOUT_MS);
    };

    const applyDragMoveSnapshot = (
        snapshot: PendingDragPointer,
        options: { applyVisual?: boolean } = {},
    ) => {
        const applyStartedAt = now();
        const primaryId = activeDragId;
        if (!primaryId) return;

        if (lastDragFrameAt !== null) {
            const frameGap = applyStartedAt - lastDragFrameAt;
            dragMaxFrameGapMs = Math.max(dragMaxFrameGapMs, frameGap);
            if (frameGap > 34) {
                dragLongFrameCount += 1;
            }
        }
        lastDragFrameAt = applyStartedAt;
        dragFrameCount += 1;

        // Threshold check for "Click" vs "Drag"
        if (!hasMoved) {
            const start = dragStartPositions[primaryId];
            if (start) {
                const dx = snapshot.clientX - dragOffset.x;
                const dy = snapshot.clientY - dragOffset.y;
                if (Math.hypot(dx - start.x, dy - start.y) > 3) {
                    hasMoved = true;
                }
            }
        }

        let dx = snapshot.clientX - dragOffset.x;
        let dy = snapshot.clientY - dragOffset.y;

        const primaryStart = dragStartPositions[primaryId];
        if (!primaryStart) return;

        if (snapshot.alignment || snapshot.cascade) {
            const threshold = 15;

            if (snapshot.cascade) {
                const mx = snapshot.clientX;
                const my = snapshot.clientY;
                const target = dragTargetIndex?.findCascadeTarget(mx, my).target;

                if (target) {
                    dx = target.x + 20;
                    dy = target.y + 20;
                }
            } else if (snapshot.alignment) {
                const size = draggedUnitSize;
                if (size && dragTargetIndex) {
                    const candidates = dragTargetIndex.findAlignmentTargets(
                        dx,
                        dy,
                        size.w,
                        size.h,
                        threshold,
                    );

                    for (const target of candidates.xTargets) {
                        if (Math.abs(dx - (target.x + target.w)) < threshold) {
                            dx = target.x + target.w;
                            break;
                        }
                        if (Math.abs((dx + size.w) - target.x) < threshold) {
                            dx = target.x - size.w;
                            break;
                        }
                    }
                    for (const target of candidates.yTargets) {
                        if (Math.abs(dy - (target.y + target.h)) < threshold) {
                            dy = target.y + target.h;
                            break;
                        }
                        if (Math.abs((dy + size.h) - target.y) < threshold) {
                            dy = target.y - size.h;
                            break;
                        }
                    }
                }
            }
        }

        const deltaX = dx - primaryStart.x;
        const deltaY = dy - primaryStart.y;

        const nextPositions: DragPositionMap = {};
        let changed = false;
        const currentPositions = latestDragPositions;

        for (const id in dragStartPositions) {
            const start = dragStartPositions[id];
            const next = {
                x: start.x + deltaX,
                y: start.y + deltaY,
            };
            nextPositions[id] = next;
            const current = currentPositions?.[id] ?? start;
            if (current.x !== next.x || current.y !== next.y) {
                changed = true;
            }
        }

        if (changed) {
            latestDragPositions = nextPositions;
            // Raw pointer events already own the ordinary visual transform. RAF
            // only recomputes state/link previews; writing the same transform from
            // a second clock makes the sticker alternate between cursor samples.
            if (options.applyVisual !== false || snapshot.alignment || snapshot.cascade) {
                applyDragVisualFastPath(nextPositions);
            }

            if (
                graphStore.links.length > 0 &&
                applyStartedAt - lastLinkPreviewCommitAt >= LINK_PREVIEW_INTERVAL_MS
            ) {
                setMultiDragPositions(nextPositions);
                lastLinkPreviewCommitAt = applyStartedAt;
                dragLinkPreviewCount += 1;
            }
        }

        dragMaxApplyMs = Math.max(dragMaxApplyMs, now() - applyStartedAt);
    };

    const flushPendingDragMove = () => {
        if (dragMoveRafId !== null && typeof window !== "undefined") {
            window.cancelAnimationFrame(dragMoveRafId);
            dragMoveRafId = null;
        }
        const snapshot = pendingDragPointer;
        pendingDragPointer = null;
        if (snapshot) {
            applyDragMoveSnapshot(snapshot);
        }
    };

    const scheduleDragMoveFrame = () => {
        if (typeof window === "undefined") {
            flushPendingDragMove();
            return;
        }
        if (dragMoveRafId !== null) return;
        dragMoveRafId = window.requestAnimationFrame(() => {
            dragMoveRafId = null;
            const snapshot = pendingDragPointer;
            pendingDragPointer = null;
            if (snapshot) {
                applyDragMoveSnapshot(snapshot, { applyVisual: false });
            }
        });
    };

    const startDrag = (e: MouseEvent, id: string, onClick?: (id: string) => void) => {
        abortActiveDrag("restart");
        const unitById = new Map(graphStore.units.map((unit) => [unit.id, unit]));
        const unit = unitById.get(id);
        if (unit) {
             hasCommittedDragFrame = false;
             dragOffset = { x: e.clientX - unit.x, y: e.clientY - unit.y };
             activeDragId = id;
             setDraggingStickerId(id);

             // Reset Interaction State
             hasMoved = false;
             clickHandler = onClick;
             latestDragPositions = null;
             lastLinkPreviewCommitAt = Number.NEGATIVE_INFINITY;
             dragRawMoveCount = 0;
             dragFrameCount = 0;
             dragLinkPreviewCount = 0;
             dragLongFrameCount = 0;
             dragMaxFrameGapMs = 0;
             dragMaxApplyMs = 0;
             lastDragFrameAt = null;
             dragStartedPrewarmed = false;

             // Initialize Multi-Drag
             // Determine if we are dragging a selection or a single unit
             const selection = selectedUnitIds;
             const isMulti = selection.includes(id) && selection.length > 1;

             const targetIds = isMulti ? selection : [id];

             dragStartPositions = {};

             targetIds.forEach(tid => {
                 const u = unitById.get(tid);
                 if (u) {
                     dragStartPositions[tid] = { x: u.x, y: u.y };
                 }
             });
             const draggedUnitIds = new Set(Object.keys(dragStartPositions));
             dragTargetIndex = buildDragTargetIndex(graphStore.units, draggedUnitIds);
             draggedUnitSize = { w: unit.w, h: unit.h };
             gpuWarmDragIds = Object.keys(dragStartPositions);
             dragStartedPrewarmed = isStickerGpuWarm(id);
             for (const unitId of gpuWarmDragIds) {
                 beginStickerGpuWarmDrag(unitId);
             }
             prepareDragVisualFastPath();
             setMultiDragPositions(null);
             startDragWatchdog();
        }
    };

    const handleDragMove = (e: MouseEvent) => {
        if (!activeDragId) return;
        dragRawMoveCount += 1;

        pendingDragPointer = {
            clientX: e.clientX,
            clientY: e.clientY,
            alignment: checkDragModifier(e, "alignment"),
            cascade: checkDragModifier(e, "cascade"),
        };
        lastDragActivityAt = Date.now();
        if (!hasCommittedDragFrame) {
            hasCommittedDragFrame = true;
            flushPendingDragMove();
            return;
        }
        // Keep the visual surface under the physical cursor immediately. RAF is
        // still retained for snapping, link previews, metrics, and the committed
        // position, but no longer imposes a one-frame lag on ordinary dragging.
        applyImmediateDragVisual(pendingDragPointer);
        scheduleDragMoveFrame();
    };

    const handleWindowBlur = () => abortActiveDrag("blur");
    const handleVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
            abortActiveDrag("hidden");
        }
    };
    const handlePointerCancel = () => abortActiveDrag("pointercancel");

    if (typeof window !== "undefined") {
        window.addEventListener("blur", handleWindowBlur);
        window.addEventListener("pointercancel", handlePointerCancel, true);
    }
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    onCleanup(() => {
        if (typeof window !== "undefined") {
            window.removeEventListener("blur", handleWindowBlur);
            window.removeEventListener("pointercancel", handlePointerCancel, true);
        }
        if (typeof document !== "undefined") {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        }
        abortActiveDrag("cleanup");
    });

    const handleDragEnd = async () => {
        const id = activeDragId;

        if (!id) return;
        clearDragWatchdog();
        flushPendingDragMove();
        hasCommittedDragFrame = false;
        const positions = latestDragPositions;

        // 1. Handle Click (No Drag)
        if (!hasMoved) {
            if (clickHandler) clickHandler(id);
            // Reset and return
            batch(() => {
                setDraggingStickerId(null);
                setMultiDragPositions(null);
            });
            clearDragVisualFastPath();
            finishGpuWarmDrag();
            activeDragId = null;
            latestDragPositions = null;
            dragStartPositions = {};
            dragTargetIndex = null;
            draggedUnitSize = null;
            clickHandler = undefined;
            return;
        }

        // 2. Commit All Positions to Store (BEFORE clearing transient state to prevent flicker)
        let changed = false;
        batch(() => {
            if (positions) {
                const unitById = new Map(graphStore.units.map((unit) => [unit.id, unit]));
                for (const uid in positions) {
                    const final = positions[uid];
                    const original = unitById.get(uid);

                    if (original && (original.x !== final.x || original.y !== final.y)) {
                        graphStore.actions.updateUnit(uid, { x: final.x, y: final.y });
                        changed = true;
                    }
                }
            }

            // 3. Clear Transient State in the same reactive flush as the commit.
            setDraggingStickerId(null);
            setMultiDragPositions(null);
        });
        clearDragVisualFastPath();
        finishGpuWarmDrag();
        activeDragId = null;
        latestDragPositions = null;
        dragStartPositions = {};
        dragTargetIndex = null;
        draggedUnitSize = null;
        clickHandler = undefined;

        void api.debugLogEvent(
            "sticker-drag-performance",
            `unit=${id} prewarmed=${dragStartedPrewarmed ? 1 : 0} rawMoves=${dragRawMoveCount} frames=${dragFrameCount} linkFrames=${dragLinkPreviewCount} longFrames=${dragLongFrameCount} maxFrameGapMs=${dragMaxFrameGapMs.toFixed(1)} maxApplyMs=${dragMaxApplyMs.toFixed(2)}`,
        );

        if (changed) {
            void (async () => {
                await syncService.updateBackendRects();
                await syncService.performWorkflowSync();
            })();
        }
    };

    return { startDrag, handleDragMove, handleDragEnd };
}
