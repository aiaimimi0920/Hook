import { unwrap } from "solid-js/store";
import { api } from "../services/api";
import { Unit, Link, UnitData } from "../types/unit";
import { mousePos, selectedStickerId, selectedStickerAnnotationId, setSelectedStickerId, clipboard, setClipboard, ClipboardData, uiActions } from "../store/uiStore";
import { logger } from "../services/logger";
import { graphStore } from "../store/graphStore";
import { syncService } from "../services/syncService";
import { renderStickerComposite } from "../services/stickerExport";
import { captureStickerEditSnapshot } from "../services/stickerHistory";
import { duplicateAnnotationById } from "../services/stickerAnnotationMutations";


export function useClipboard() {

    const handleCopy = async () => {
        const id = selectedStickerId();
        const annotationId = selectedStickerAnnotationId();
        const mp = mousePos();

        if (id) {
            const unit = graphStore.units.find(u => u.id === id);
            if (unit && unit.type === 'sticker') {
                if (annotationId && unit.data.annotationState) {
                    const duplicated = duplicateAnnotationById(unit.data.annotationState, annotationId);
                    if (duplicated.createdAnnotationId) {
                        uiActions.pushStickerHistory(id, captureStickerEditSnapshot(unit));
                        graphStore.actions.updateUnitData(id, {
                            annotationState: {
                                ...unit.data.annotationState,
                                elements: duplicated.elements,
                            },
                        });
                        uiActions.setSelectedStickerAnnotation(duplicated.createdAnnotationId);
                        await syncService.performWorkflowSync();
                        return;
                    }
                }

                const s = unwrap(unit);

                const nextClipState: ClipboardData = {
                    src: s.data.src || "",
                    w: s.w,
                    h: s.h,
                    minified: s.data.minified,
                    savedRect: s.data.savedRect,
                    cropOffset: s.data.cropOffset,
                    opacityNormal: s.data.opacityNormal,
                    opacityMini: s.data.opacityMini,
                    rasterizedAnnotationLayerSrc: s.data.rasterizedAnnotationLayerSrc,
                    annotationState: s.data.annotationState,
                    imageEditState: s.data.imageEditState,
                    groupId: s.data.groupId,
                    captureMeta: s.data.captureMeta,

                    offsetX: mp.x - s.x,
                    offsetY: mp.y - s.y,

                    // Cascade Init
                    originalId: s.id,
                    originalX: s.x,
                    originalY: s.y,
                    nextCascadeX: s.x + 20, // Initial cascade step
                    nextCascadeY: s.y + 20
                };

                setClipboard(nextClipState);

                const dpr = window.devicePixelRatio || 1;
                console.log("Copy Internal:", {
                    dpr,
                    mp,
                    unit: {x: s.x, y: s.y},
                    offset: {x: nextClipState.offsetX, y: nextClipState.offsetY}
                });
                console.log("Copied to internal clipboard");

                try {
                    const exportBase64 = await renderStickerComposite(unit);
                    if (s.data.src) {
                        const path = await api.copyStickerImageToSmartClipboard(exportBase64);
                        logger.info(`Copied to smart system clipboard as image/file: ${path}`);
                    } else {
                        // If no image, fallback to JSON text for node data
                        await navigator.clipboard.writeText(JSON.stringify(nextClipState));
                    }
                } catch (e) {
                    console.error("Clipboard write failed", e);
                }
                return;
            }
        }
    };

    const handlePaste = async () => {
        // 0. Get Absolute Cursor Position from Backend (Handles transparent/click-through areas)
        let mp = mousePos(); // Fallback
        try {
            const rawPos = await api.getCursorPosition();
            if (rawPos) {
                 // Convert physical pixels to logical CSS pixels if needed
                 // The backend uses Window::cursor_position() which returns physical pixels?
                 // Wait, tauri::CursorPosition returns Logical or Physical?
                 // lib.rs uses `PhysicalPosition<f64>`, so we need to divide by DPR.
                 const dpr = window.devicePixelRatio || 1;
                 mp = { x: rawPos.x / dpr, y: rawPos.y / dpr };
                 console.log("Paste: Using Backend Cursor Pos", mp);
            }
        } catch (e) {
            console.warn("Backend cursor fetch failed, using cached JS mousePos", e);
        }

        // 1. Try Internal Clipboard First (Fastest, preserves Types)
        const clip = clipboard();

        if (clip) {
            pasteClipboardData(clip, mp);
            return;
        }

        // 2. Try System Clipboard
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                // Try Parse as ClipboardData
                try {
                    const data = JSON.parse(text);
                    // Check if it matches ClipboardData structure (Sticker)
                    if (data.src && (data.w || data.h)) {
                        pasteClipboardData(data, mp);
                        return;
                    }
                    // Fallback: Check for Array (New/ComfyUI format)
                    else if (Array.isArray(data)) {
                         pasteNodes(data, [], mp); // Pass MP explicitly
                         return;
                    }
                } catch (e) {
                    // Not JSON
                }
            }

            // 3. Image Binary
             const items = await navigator.clipboard.read();
             for (const item of items) {
                 if (item.types.some(t => t.startsWith("image/"))) {
                     const blob = await item.getType(item.types.find(t => t.startsWith("image/"))!);
                     const reader = new FileReader();
                     reader.onload = async () => {
                          const base64 = reader.result as string;
                          createImageUnit(base64, mp); // Pass MP explicitly
                     };
                     reader.readAsDataURL(blob);
                     return;
                 }
             }

        } catch (e) {
            console.error("Paste failed", e);
        }
    };

    const handleSave = async () => {
        const id = selectedStickerId();
        if (!id) return;
        const unit = graphStore.units.find((candidate) => candidate.id === id);
        if (!unit || unit.type !== "sticker") return;

        try {
            const exportBase64 = await renderStickerComposite(unit);
            const centerX = unit.x + unit.w / 2;
            const centerY = unit.y + unit.h / 2;
            const path = await api.saveStickerImageAs(exportBase64, centerX, centerY);
            if (path) {
                logger.info(`Saved sticker composite to: ${path}`);
            }
        } catch (error) {
            console.error("Save sticker composite failed", error);
        }
    };

    // Helper to detect if mouse is "inside" the original source node's area
    const isMouseInsideOriginal = (clip: ClipboardData, mx: number, my: number) => {
        // Try to find the original unit to get its CURRENT position
        // This handles cases where the user moved the node after copying
        const currentUnit = graphStore.units.find(u => u.id === clip.originalId);

        let targetX = clip.originalX;
        let targetY = clip.originalY;
        let targetW = clip.w;
        let targetH = clip.h;

        if (currentUnit) {
            targetX = currentUnit.x;
            targetY = currentUnit.y;
            targetW = currentUnit.w;
            targetH = currentUnit.h;
        }

        return (mx >= targetX && mx <= targetX + targetW &&
                my >= targetY && my <= targetY + targetH);
    };

    const pasteClipboardData = (clip: ClipboardData, mp: {x: number, y: number}) => {
        let newX = mp.x;
        let newY = mp.y;

        // CASCADE MODE DETECTION
        // Logic: If mouse is inside the original source rect, we assume the user wants to "duplicate on top".
        // In this case, we use the `nextCascade` position instead of mouse position.
        const inside = isMouseInsideOriginal(clip, mp.x, mp.y);
        let isCascade = inside;

        if (isCascade) {
            newX = clip.nextCascadeX;
            newY = clip.nextCascadeY;
            console.log("PASTE DEBUG [Cascade Mode]:", {
                mousePos: mp,
                originalId: clip.originalId,
                nextCascade: { x: newX, y: newY }
            });
        } else {
            // RELATIVE MODE
            // Restore Mouse Offset so the node appears "under" the cursor exactly as copied
            if (clip.offsetX !== undefined && clip.offsetY !== undefined) {
                 newX = mp.x - clip.offsetX;
                 newY = mp.y - clip.offsetY;
            } else {
                 newX = mp.x;
                 newY = mp.y;
            }

            console.log("PASTE DEBUG [Relative Mode]:", {
                mousePos: mp,
                calculated: { x: newX, y: newY },
                clipboardData: clip, // Log full clip data to check for offsets/rects
                windowState: {
                    scrollX: window.scrollX,
                    scrollY: window.scrollY,
                    innerWidth: window.innerWidth,
                    innerHeight: window.innerHeight,
                    dpr: window.devicePixelRatio
                },
                screen: { width: window.screen.width, height: window.screen.height }
            });
        }

        // Apply Crop Offset if applicable (Legacy behavior for cropped stickers)
        let finalX = newX;
        let finalY = newY;
        let finalW = clip.w;
        let finalH = clip.h;

        if (clip.savedRect && clip.cropOffset) {
             // Legacy adjustment removed to prioritize exact mouse positioning
             // finalX = newX - clip.cropOffset.x;
             // finalY = newY - clip.cropOffset.y;
        }

        // Create Unit
        const newUnit: Unit = {
            id: crypto.randomUUID(),
            type: 'sticker',
            x: finalX,
            y: finalY,
            w: finalW,
            h: finalH,
            params: {},
            inputs: [],
            outputs: [],
            data: {
                src: clip.src,
                minified: clip.minified,
                savedRect: clip.savedRect,
                cropOffset: clip.cropOffset,
                opacityNormal: clip.opacityNormal,
                opacityMini: clip.opacityMini,
                rasterizedAnnotationLayerSrc: clip.rasterizedAnnotationLayerSrc,
                annotationState: clip.annotationState,
                imageEditState: clip.imageEditState,
                groupId: clip.groupId,
                captureMeta: clip.captureMeta,
            }
        };

        graphStore.actions.addUnit(newUnit);
        setSelectedStickerId(newUnit.id); // Validates "Higher Level" (Z-Index/Active)
        syncService.updateBackendRects();

        // Debug Logs
        console.log("Paste:", { isCascade, newX, newY, nextCascadeX: clip.nextCascadeX });

        // CHAINING / CASCADE UPDATE
        // Update the clipboard state so the *next* paste considers this new unit as the "original" (Anchor).
        // This allows:
        // 1. "Spamming Paste" -> Cascades nicely (A -> B -> C -> D)
        // 2. moving mouse away -> Pastes at new location (Relative)
        const nextClip: ClipboardData = {
            ...clip,
            // Update Anchor to the new unit
            originalId: newUnit.id,
            originalX: newX,
            originalY: newY,
            // Prepare next cascade step relative to THIS unit
            nextCascadeX: newX + 20,
            nextCascadeY: newY + 20
        };
        setClipboard(nextClip);
        console.log("Updated Clipboard Anchor:", { id: nextClip.originalId, nextCascade: { x: nextClip.nextCascadeX, y: nextClip.nextCascadeY } });
    };

    const pasteNodes = (nodes: any[], links: any[] = [], mpOverride?: {x: number, y: number}) => {
         const idMap: Record<string, string> = {};
         const mp = mpOverride || mousePos();

         let minX = Infinity, minY = Infinity;
         nodes.forEach(n => {
             if (n.x < minX) minX = n.x;
             if (n.y < minY) minY = n.y;
         });

         const newUnits: Unit[] = nodes.map(n => {
             const newId = crypto.randomUUID();
             idMap[n.id] = newId;
             return {
                 ...n,
                 id: newId,
                 x: mp.x + (n.x - minX),
                 y: mp.y + (n.y - minY),
                 params: { ...n.params }
             };
         });

         const newLinks: Link[] = links.map(l => ({
            id: crypto.randomUUID(),
            fromUnitId: idMap[l.fromUnitId] || l.fromUnitId,
            fromPortId: l.fromPortId,
            toUnitId: idMap[l.toUnitId] || l.toUnitId,
            toPortId: l.toPortId
        })).filter(l => idMap[l.fromUnitId] && idMap[l.toUnitId]);

         newUnits.forEach(u => graphStore.actions.addUnit(u));
         newLinks.forEach(l => graphStore.actions.addLink(l));

         if (newUnits.length > 0) setSelectedStickerId(newUnits[newUnits.length-1].id);

         syncService.updateBackendRects();
         syncService.performWorkflowSync();
    }

    const createImageUnit = (base64: string, mpOverride?: {x: number, y: number}) => {
        const mp = mpOverride || mousePos();
        const newUnit: Unit = {
            id: crypto.randomUUID(),
            type: 'sticker',
            x: mp.x,
            y: mp.y,
            w: 300,
            h: 300,
            params: {},
            inputs: [],
            outputs: [],
            data: {
                src: base64,
                minified: false
            }
        };
        graphStore.actions.addUnit(newUnit);
        syncService.updateBackendRects();
        return newUnit.id;
    };

    return { handlePaste, handleCopy, handleSave, createImageUnit };
}
