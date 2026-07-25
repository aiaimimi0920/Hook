import { createSignal } from "solid-js";
import {
    draggingStickerId, setDraggingStickerId,
    selectedUnitIds,
    multiDragPositions, setMultiDragPositions
} from "../store/uiStore";
import { graphStore } from "../store/graphStore";
import { syncService } from "../services/syncService";
import { checkDragModifier } from "./useShortcuts";

// Snapshot of original positions at start of drag
let dragStartPositions: Record<string, {x: number, y: number}> = {};
let hasMoved = false; // Track if actual movement occurred
let clickHandler: ((id: string) => void) | undefined; // Callback for click (no-drag)
type PendingDragPointer = {
    clientX: number;
    clientY: number;
    alignment: boolean;
    cascade: boolean;
};

export function useDraggable() {
    const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });
    let pendingDragPointer: PendingDragPointer | null = null;
    let dragMoveRafId: number | null = null;
    let hasCommittedDragFrame = false;

    const applyDragMoveSnapshot = (snapshot: PendingDragPointer) => {
        const primaryId = draggingStickerId();
        if (!primaryId) return;

        // Threshold check for "Click" vs "Drag"
        if (!hasMoved) {
            const start = dragStartPositions[primaryId];
            if (start) {
                const dx = snapshot.clientX - dragOffset().x;
                const dy = snapshot.clientY - dragOffset().y;
                if (Math.hypot(dx - start.x, dy - start.y) > 3) {
                    hasMoved = true;
                }
            }
        }

        let dx = snapshot.clientX - dragOffset().x;
        let dy = snapshot.clientY - dragOffset().y;

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

        const nextPositions: Record<string, {x: number, y: number}> = {};
        let changed = false;
        const currentPositions = multiDragPositions();

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
            setMultiDragPositions(nextPositions);
        }
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
        const unit = graphStore.units.find(u => u.id === id);
        if (unit) {
             flushPendingDragMove();
             pendingDragPointer = null;
             hasCommittedDragFrame = false;
             setDragOffset({ x: e.clientX - unit.x, y: e.clientY - unit.y });
             setDraggingStickerId(id);

             // Reset Interaction State
             hasMoved = false;
             clickHandler = onClick;

             // Initialize Multi-Drag
             // Determine if we are dragging a selection or a single unit
             const selection = selectedUnitIds;
             const isMulti = selection.includes(id) && selection.length > 1;

             const targetIds = isMulti ? selection : [id];

             dragStartPositions = {};

             targetIds.forEach(tid => {
                 const u = graphStore.units.find(u => u.id === tid);
                 if (u) {
                     dragStartPositions[tid] = { x: u.x, y: u.y };
                 }
             });
             if (multiDragPositions()) {
                 setMultiDragPositions(null);
             }
        }
    };

    const handleDragMove = (e: MouseEvent) => {
        if (!draggingStickerId()) return;

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

    const handleDragEnd = async () => {
        const id = draggingStickerId();

        if (!id) return;
        flushPendingDragMove();
        hasCommittedDragFrame = false;
        const positions = multiDragPositions();

        // 1. Handle Click (No Drag)
        if (!hasMoved) {
            if (clickHandler) clickHandler(id);
            // Reset and return
            setDraggingStickerId(null);
            setMultiDragPositions(null);
            return;
        }

        // 2. Commit All Positions to Store (BEFORE clearing transient state to prevent flicker)
        let changed = false;
        if (positions) {
            for (const uid in positions) {
                const final = positions[uid];
                const original = graphStore.units.find(u => u.id === uid);

                if (original && (original.x !== final.x || original.y !== final.y)) {
                    graphStore.actions.updateUnit(uid, { x: final.x, y: final.y });
                    changed = true;
                }
            }
        }

        // 3. Clear Transient State
        setDraggingStickerId(null);
        setMultiDragPositions(null);

        if (changed) {
            void (async () => {
                await syncService.updateBackendRects();
                await syncService.performWorkflowSync();
            })();
        }
    };

    return { startDrag, handleDragMove, handleDragEnd };
}
