import { api } from "../services/api";
import { graphStore } from "../store/graphStore";
import { syncService } from "../services/syncService";
import { logger } from "../services/logger";
import { setDraggingStickerId, setMultiDragPositions } from "../store/uiStore";
import {
    computeMinifiedStickerWindow,
    computeRestoredMinifiedStickerWindow,
} from "../services/stickerEditing";
import { resolveStickerSurfaceDoubleClickTarget } from "../services/stickerDoubleClick";
import { useNodeParameters } from "./useNodeParameters";
import { DEFAULT_EXECUTION_CONFIG, type Unit } from "../types/unit";
import { resolveConnectedUnitImageForPort } from "../services/graphImageResolution";
import { getCapabilityInputsForPorts } from "../services/artPorts";
import { deriveUnitExecutionConfig } from "../services/nodeExecutionConfig";
import { findArtCapability } from "../services/artCapabilityLookup";
import { buildStandaloneArtNodeUnit } from "../services/artNodeFactory";
import { runWithLiveCaptureSnapshots } from "../services/liveCaptureSnapshotAction";

const getSourceImageFrame = (unit: Unit): { w: number; h: number } => {
    const savedRect = unit.data.savedRect;
    if (unit.data.minified && savedRect) {
        return { w: savedRect.w, h: savedRect.h };
    }

    return { w: unit.w, h: unit.h };
};

export function useUnitActions() {

    // Import logic from new hook
    const { handleParamChange } = useNodeParameters();
    const getPrimaryImageInputPort = (artId: string) => {
        const capability = findArtCapability(graphStore.capabilities, artId);
        const inputs = getCapabilityInputsForPorts(capability);
        const imageInput = inputs.find((input) =>
            (input.type || "").toLowerCase().includes("image") ||
            ["input", "input_image", "image"].includes((input.name || "").toLowerCase())
        );
        return imageInput?.name || inputs[0]?.name || "input_image";
    };

    // Helper: Recursive Propagation (Frontend Only for Stickers)
    const propagateFromUnit = (fromUnitId: string) => {
        // Find direct downstream links
        const outLinks = graphStore.links.filter(l => l.fromUnitId === fromUnitId);

        outLinks.forEach(l => {
            const childId = l.toUnitId;
            const childUnit = graphStore.units.find(u => u.id === childId);
            if (!childUnit) return;

            if (childUnit.type === 'art') {
                const childCapability = childUnit.artId
                    ? findArtCapability(graphStore.capabilities, childUnit.artId)
                    : undefined;
                const childExecConfig = deriveUnitExecutionConfig({
                    capability: childCapability,
                    explicitConfig:
                        graphStore.unitExecConfig[childId] ||
                        childUnit.data?.executionConfig ||
                        DEFAULT_EXECUTION_CONFIG,
                });
                if (!(childExecConfig.propagation?.listenUpstream ?? true)) return;
                if (!(childExecConfig.triggerMode?.upstreamDriven ?? true)) return;

                logger.debug(`[Propagation] Triggering Art Node ${childId} via ${l.toPortId}`);
                const targetParam = l.toPortId || "input";
                const val =
                    graphStore.unitParams[childId]?.[targetParam] ??
                    childUnit.params?.[targetParam] ??
                    true;
                setTimeout(() => {
                    handleParamChange(childId, targetParam, val, true, "upstream");
                }, 10);
            } else if (childUnit.type === 'sticker') {
                // STICKER: consume the linked output port. For workflow Arts,
                // this remains empty until the formal result arrives and never
                // falls back to the Art's faster visual preview.
                const inputValue = resolveConnectedUnitImageForPort({
                    units: graphStore.units,
                    links: graphStore.links,
                    capabilities: graphStore.capabilities,
                    unitId: childId,
                    portId: l.toPortId,
                });

                if (inputValue) {
                     logger.debug(`[Propagation] Updating Sticker ${childId} with new input`);
                     // Update Child Sticker
                     graphStore.actions.updateUnitData(childId, {
                         previewSrc: inputValue
                         // Note: We don't overwrite 'src' (original screenshot)
                         // 'previewSrc' acts as the layer above it.
                     });

                     // RECURSIVE: Propagate further from this child. Defer to a
                     // microtask so the updateUnitData write above has settled
                     // before we read it, without a magic timer delay.
                     queueMicrotask(() => propagateFromUnit(childId));
                }
            }
        });
    };

    // Extracted from App.tsx - Windowing/Crop Logic
    const handleDoubleClick = (e: MouseEvent, id: string) => {
          e.stopPropagation();

          const u = graphStore.units.find(u => u.id === id);
          if (!u) return;

          // RESTORE FULL VIEW
          if (u.data.minified) {
               setDraggingStickerId(null);
               setMultiDragPositions(null);
               const saved = u.data.savedRect;
               if (saved) {
                   const restored = computeRestoredMinifiedStickerWindow(
                       { x: u.x, y: u.y, w: u.w, h: u.h },
                       saved,
                       u.data.cropOffset,
                   );
                   graphStore.actions.updateStickerWindowState(
                       id,
                       {
                           x: restored.x,
                           y: restored.y,
                           w: restored.w,
                           h: restored.h,
                       },
                       {
                           minified: false,
                       },
                   );
               } else {
                   graphStore.actions.updateUnitData(id, { minified: false });
               }
               void syncService.performWorkflowSync();
               return;
          }

          // Double-click centers the compact crop around the clicked point.
          const target = resolveStickerSurfaceDoubleClickTarget(e.target, e.currentTarget)
              ?? (e.currentTarget instanceof HTMLElement ? e.currentTarget : null);
          if (!target) return;
          const rect = target.getBoundingClientRect();
          if (
              !Number.isFinite(rect.width)
              || !Number.isFinite(rect.height)
              || rect.width <= 0
              || rect.height <= 0
          ) return;
          // Relative click in the full visible sticker frame. The mini window
          // position should stay centered on the actual click whenever the
          // square crop fits inside the full sticker bounds.
          const relX = (e.clientX - rect.left) / rect.width;
          const relY = (e.clientY - rect.top) / rect.height;
          const minified = computeMinifiedStickerWindow(
              { x: u.x, y: u.y, w: u.w, h: u.h },
              relX,
              relY,
          );

          setDraggingStickerId(null);
          setMultiDragPositions(null);

          void api.debugLogEvent(
              "sticker-double-click-window",
              `unit=${id} relX=${relX.toFixed(4)} relY=${relY.toFixed(4)} rectW=${rect.width.toFixed(2)} rectH=${rect.height.toFixed(2)} offsetX=${minified.cropOffset.x.toFixed(2)} offsetY=${minified.cropOffset.y.toFixed(2)} frameX=${minified.frame.x.toFixed(2)} frameY=${minified.frame.y.toFixed(2)}`,
          );

          // Apply Changes
          graphStore.actions.updateStickerWindowState(
              id,
              {
                  x: minified.frame.x,
                  y: minified.frame.y,
                  w: minified.frame.w,
                  h: minified.frame.h,
              },
              {
                  minified: true,
                  savedRect: minified.savedRect,
                  cropOffset: minified.cropOffset,
              },
          );

          void syncService.performWorkflowSync();
    };

    // Extracted from App.tsx - Inline Logic
    const spawnConnectedNode = (fromId: string, artId: string) => runWithLiveCaptureSnapshots([fromId], () => {
         const u = graphStore.units.find(u => u.id === fromId);
         if (!u) return null;

         const sourceFrame = getSourceImageFrame(u);
         const capability = findArtCapability(graphStore.capabilities, artId);
         if (!capability) {
             const details = `source=${fromId} requested=${artId} capabilities=${graphStore.capabilities.length}`;
             console.error(`[Art node] Refusing to create an unresolved Art node: ${details}`);
             void api.debugLogEvent("art-node-create-blocked-missing-capability", details);
             return null;
         }

         const canonicalArtId = capability.id;
         const newId = crypto.randomUUID();
         const node = buildStandaloneArtNodeUnit({
             id: newId,
             capability,
             x: u.x + u.w + 50,
             y: u.y,
             w: sourceFrame.w,
             h: sourceFrame.h,
         });
         graphStore.actions.addUnit(node);
         graphStore.actions.addLink({
             id: crypto.randomUUID(),
             fromUnitId: fromId, fromPortId: 'output',
             toUnitId: newId, toPortId: getPrimaryImageInputPort(canonicalArtId)
         });
         syncService.updateBackendRects();
         syncService.performWorkflowSync();
         queueMicrotask(() => propagateFromUnit(fromId));
         return newId;
    });

    return {
        handleParamChange,
        propagateFromUnit,
        handleDoubleClick,
        spawnConnectedNode,
    };
}
