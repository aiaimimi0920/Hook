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

type DragPosition = { x: number; y: number };
type DragPositionMap = Record<string, DragPosition>;

// Snapshot of original positions at start of drag
let dragStartPositions: DragPositionMap = {};
let latestDragPositions: DragPositionMap | null = null;
let hasMoved = false; // Track if actual movement occurred
let clickHandler: ((id: string) => void) | undefined; // Callback for click (no-drag)
const LINK_PREVIEW_INTERVAL_MS = 32;
const DRAG_FOLLOW_SELECTOR = "[data-hook-drag-follow-unit-id]";

type DragFollowerStyle = {
    element: HTMLElement;
    transform: string;
    willChange: string;
    transitionProperty: string;
};

let dragFollowerStyles: DragFollowerStyle[] = [];
let dragFollowersCollected = false;

const collectDragFollowers = () => {
    dragFollowersCollected = true;
    dragFollowerStyles = [];
    if (typeof document === "undefined") return;

    const activeIds = new Set(Object.keys(dragStartPositions));
    document.querySelectorAll<HTMLElement>(DRAG_FOLLOW_SELECTOR).forEach((element) => {
        const unitId = element.getAttribute("data-hook-drag-follow-unit-id");
        if (!unitId || !activeIds.has(unitId)) return;
        dragFollowerStyles.push({
            element,
            transform: element.style.transform,
            willChange: element.style.willChange,
            transitionProperty: element.style.transitionProperty,
        });
    });
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
        const unitId = follower.element.getAttribute("data-hook-drag-follow-unit-id");
        if (!unitId) continue;
        const start = dragStartPositions[unitId];
        const position = positions[unitId];
        if (!start || !position) continue;

        follower.element.style.transform = `translate3d(${position.x - start.x}px, ${position.y - start.y}px, 0)`;
        follower.element.style.willChange = "transform";
        follower.element.style.transitionProperty = "none";
    }
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

type PendingDragPointer = {
    clientX: number;
    clientY: number;
    alignment: boolean;
    cascade: boolean;
};

export function useDraggable() {
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

    const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();

    const finishGpuWarmDrag = () => {
        const completedIds = gpuWarmDragIds;
        gpuWarmDragIds = [];
        for (const unitId of completedIds) {
            endStickerGpuWarmDrag(unitId);
        }
    };

    const applyDragMoveSnapshot = (snapshot: PendingDragPointer) => {
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
                const allUnits = graphStore.units;

                for (let i = allUnits.length - 1; i >= 0; i--) {
                    const target = allUnits[i];
                    if (dragStartPositions[target.id]) continue;

                    if (
                        mx >= target.x && mx <= target.x + target.w &&
                        my >= target.y && my <= target.y + target.h
                    ) {
                        dx = target.x + 20;
                        dy = target.y + 20;
                        break;
                    }
                }
            } else if (snapshot.alignment) {
                const draggedUnit = graphStore.units.find(s => s.id === primaryId);
                if (draggedUnit) {
                    const targetUnits = graphStore.units.filter(s => !dragStartPositions[s.id]);
                    let snappedX = false;
                    let snappedY = false;

                    for (const target of targetUnits) {
                        if (!snappedX) {
                            if (Math.abs(dx - (target.x + target.w)) < threshold) {
                                dx = target.x + target.w;
                                snappedX = true;
                            }
                            else if (Math.abs((dx + draggedUnit.w) - target.x) < threshold) {
                                dx = target.x - draggedUnit.w;
                                snappedX = true;
                            }
                        }
                        if (!snappedY) {
                            if (Math.abs(dy - (target.y + target.h)) < threshold) {
                                dy = target.y + target.h;
                                snappedY = true;
                            }
                            else if (Math.abs((dy + draggedUnit.h) - target.y) < threshold) {
                                dy = target.y - draggedUnit.h;
                                snappedY = true;
                            }
                        }
                        if (snappedX && snappedY) break;
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
            applyDragVisualFastPath(nextPositions);

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
                applyDragMoveSnapshot(snapshot);
            }
        });
    };

    const startDrag = (e: MouseEvent, id: string, onClick?: (id: string) => void) => {
        const unitById = new Map(graphStore.units.map((unit) => [unit.id, unit]));
        const unit = unitById.get(id);
        if (unit) {
             flushPendingDragMove();
             clearDragVisualFastPath();
             finishGpuWarmDrag();
             pendingDragPointer = null;
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
             gpuWarmDragIds = Object.keys(dragStartPositions);
             dragStartedPrewarmed = isStickerGpuWarm(id);
             for (const unitId of gpuWarmDragIds) {
                 beginStickerGpuWarmDrag(unitId);
             }
             prepareDragVisualFastPath();
             setMultiDragPositions(null);
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
        if (!hasCommittedDragFrame) {
            hasCommittedDragFrame = true;
            flushPendingDragMove();
            return;
        }
        scheduleDragMoveFrame();
    };

    onCleanup(() => {
        if (dragMoveRafId !== null && typeof window !== "undefined") {
            window.cancelAnimationFrame(dragMoveRafId);
            dragMoveRafId = null;
        }
        pendingDragPointer = null;
        clearDragVisualFastPath();
        finishGpuWarmDrag();
        activeDragId = null;
        latestDragPositions = null;
        dragStartPositions = {};
        batch(() => {
            setDraggingStickerId(null);
            setMultiDragPositions(null);
        });
    });

    const handleDragEnd = async () => {
        const id = activeDragId;

        if (!id) return;
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
