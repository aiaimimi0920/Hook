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

export function useDraggable() {
    const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });

    const startDrag = (e: MouseEvent, id: string, onClick?: (id: string) => void) => {
        const unit = graphStore.units.find(u => u.id === id);
        if (unit) {
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
             const initialPositions: Record<string, {x: number, y: number}> = {};

             targetIds.forEach(tid => {
                 const u = graphStore.units.find(u => u.id === tid);
                 if (u) {
                     dragStartPositions[tid] = { x: u.x, y: u.y };
                     initialPositions[tid] = { x: u.x, y: u.y };
                 }
             });

             // Initial State
             setMultiDragPositions(initialPositions);
        }
    };

    const handleDragMove = (e: MouseEvent) => {
        const primaryId = draggingStickerId();
        if (!primaryId) return;

        // Threshold check for "Click" vs "Drag"
        if (!hasMoved) {
            const start = dragStartPositions[primaryId];
            if (start) {
                const dx = e.clientX - dragOffset().x;
                const dy = e.clientY - dragOffset().y;
                // If moved more than 3 pixels from start
                if (Math.hypot(dx - start.x, dy - start.y) > 3) {
                    hasMoved = true;
                }
            }
        }

        let dx = e.clientX - dragOffset().x;
        let dy = e.clientY - dragOffset().y;

        // Calculate Delta based on Primary Unit (ignoring snap for now to get raw delta)
        const primaryStart = dragStartPositions[primaryId];
        if (!primaryStart) return; // Should not happen

        // --- Snapping Logic (Applied to Primary Unit) ---
        // For simplicity, snapping calculates the *Final Position* of the Primary Unit.
        // We then derive the Delta from that snapped position.

        if (checkDragModifier(e, 'alignment') || checkDragModifier(e, 'cascade')) {
               const threshold = 15;

               // CTRL: Stack/Cascade
               if (checkDragModifier(e, 'cascade')) {
                    const mx = e.clientX;
                    const my = e.clientY;
                    const allUnits = graphStore.units;

                    for (let i = allUnits.length - 1; i >= 0; i--) {
                        const target = allUnits[i];
                        if (dragStartPositions[target.id]) continue; // Skip self/selection

                        if (mx >= target.x && mx <= target.x + target.w &&
                            my >= target.y && my <= target.y + target.h) {

                            dx = target.x + 20;
                            dy = target.y + 20;
                            break;
                        }
                    }
               }
               // ALT: Adjacency
               else if (checkDragModifier(e, 'alignment')) {
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

          // Apply Delta to All Selected Units
          const deltaX = dx - primaryStart.x;
          const deltaY = dy - primaryStart.y;

          const nextPositions: Record<string, {x: number, y: number}> = {};

          for (const id in dragStartPositions) {
              const start = dragStartPositions[id];
              nextPositions[id] = {
                  x: start.x + deltaX,
                  y: start.y + deltaY
              };
          }

          setMultiDragPositions(nextPositions);
    };

    const handleDragEnd = async () => {
        const id = draggingStickerId();
        const positions = multiDragPositions();

        if (!id) return;

        // 1. Handle Click (No Drag)
        if (!hasMoved) {
            if (clickHandler) clickHandler(id);
            // Reset and return
            setDraggingStickerId(null);
            setMultiDragPositions(null);
            return;
        }

        // 2. Commit All Positions to Store (BEFORE clearing transient state to prevent flicker)
        if (positions) {
            let changed = false;

            for (const uid in positions) {
                const final = positions[uid];
                const original = graphStore.units.find(u => u.id === uid);

                if (original && (original.x !== final.x || original.y !== final.y)) {
                    graphStore.actions.updateUnit(uid, { x: final.x, y: final.y });
                    changed = true;
                }
            }

            if (changed) {
                 await syncService.updateBackendRects();
                 await syncService.performWorkflowSync();
            }
        }

        // 3. Clear Transient State
        setDraggingStickerId(null);
        setMultiDragPositions(null);
    };

    return { startDrag, handleDragMove, handleDragEnd };
}
