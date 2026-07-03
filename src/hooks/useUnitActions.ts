import { api } from "../services/api";
import { graphStore } from "../store/graphStore";
import { syncService } from "../services/syncService";
import { setDraggingStickerId, setMultiDragPositions, uiActions } from "../store/uiStore";
import { computeRestoredMinifiedStickerWindow } from "../services/stickerEditing";
import { useNodeParameters } from "./useNodeParameters";
import { DEFAULT_EXECUTION_CONFIG, type Unit } from "../types/unit";
import { resolveUnitImageFromGraph } from "../services/graphImageResolution";
import { getCapabilityInputsForPorts } from "../services/artPorts";
import { deriveUnitExecutionConfig } from "../services/nodeExecutionConfig";

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
        const capability = graphStore.capabilities.find((item) => item.id === artId);
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
                    ? graphStore.capabilities.find((item) => item.id === childUnit.artId)
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

                console.log(`[Propagation] Triggering Art Node ${childId} via ${l.toPortId}`);
                const targetParam = l.toPortId || "input";
                const val =
                    graphStore.unitParams[childId]?.[targetParam] ??
                    childUnit.params?.[targetParam] ??
                    true;
                setTimeout(() => {
                    handleParamChange(childId, targetParam, val, true, "upstream");
                }, 10);
            } else if (childUnit.type === 'sticker') {
                // STICKER: Pass-through
                const inputValue = resolveUnitImageFromGraph({
                    units: graphStore.units,
                    links: graphStore.links,
                    capabilities: graphStore.capabilities,
                    unitId: fromUnitId,
                });

                if (inputValue) {
                     console.log(`[Propagation] Updating Sticker ${childId} with new input`);
                     // Update Child Sticker
                     graphStore.actions.updateUnitData(childId, {
                         previewSrc: inputValue
                         // Note: We don't overwrite 'src' (original screenshot)
                         // 'previewSrc' acts as the layer above it.
                     });

                     // RECURSIVE: Propagate further from this child
                     setTimeout(() => propagateFromUnit(childId), 20);
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
               setTimeout(() => {
                   syncService.updateBackendRects();
                   syncService.performWorkflowSync();
               }, 100);
               return;
          }

          // LEGACY BEHAVIOR: PARTIAL PIXEL VIEW (Auto-Crop)
          // "Double click defaults to showing partial pixels near the clicked point"
          const target = e.currentTarget as HTMLElement;
          const rect = target.getBoundingClientRect();
          // Relative Click (0 to 1)
          const relX = (e.clientX - rect.left) / rect.width;
          const relY = (e.clientY - rect.top) / rect.height;

          // Unit Space Click Coordinates
          const clickUnitX = relX * u.w;
          const clickUnitY = relY * u.h;

          // Define Crop Window Size
          const CROP_SIZE = 100;

          // Center the Crop around the Click
          const offsetX = clickUnitX - (CROP_SIZE / 2);
          const offsetY = clickUnitY - (CROP_SIZE / 2);

          // Update Unit Position (keep the "visual" click point stationary on screen)
          const newX = u.x + offsetX;
          const newY = u.y + offsetY;

          setDraggingStickerId(null);
          setMultiDragPositions(null);

          void api.debugLogEvent(
              "sticker-double-click-window",
              `unit=${id} relX=${relX.toFixed(4)} relY=${relY.toFixed(4)} rectW=${rect.width.toFixed(2)} rectH=${rect.height.toFixed(2)} offsetX=${offsetX.toFixed(2)} offsetY=${offsetY.toFixed(2)} frameX=${newX.toFixed(2)} frameY=${newY.toFixed(2)}`,
          );

          // Apply Changes
          graphStore.actions.updateStickerWindowState(
              id,
              {
                  x: newX,
                  y: newY,
                  w: CROP_SIZE,
                  h: CROP_SIZE,
              },
              {
                  minified: true,
                  savedRect: { x: u.x, y: u.y, w: u.w, h: u.h },
                  cropOffset: { x: offsetX, y: offsetY },
              },
          );

          setTimeout(() => {
              syncService.updateBackendRects();
              syncService.performWorkflowSync();
          }, 100);
    };

    // Extracted from App.tsx - Inline Logic
    const spawnConnectedNode = (fromId: string, artId: string) => {
         const u = graphStore.units.find(u => u.id === fromId);
         if (u) {
             const sourceFrame = getSourceImageFrame(u);
             const capability = graphStore.capabilities.find((item) => item.id === artId);
             const newId = crypto.randomUUID();
             graphStore.actions.addUnit({
                 id: newId, type: 'art', artId,
                 x: u.x + u.w + 50, y: u.y, w: sourceFrame.w, h: sourceFrame.h,
                 params: {}, inputs: [], outputs: [],
                 data: {
                     executionConfig: deriveUnitExecutionConfig({ capability }),
                 }
             });
             graphStore.actions.addLink({
                 id: crypto.randomUUID(),
                 fromUnitId: fromId, fromPortId: 'output',
                 toUnitId: newId, toPortId: getPrimaryImageInputPort(artId)
             });
             syncService.updateBackendRects();
             syncService.performWorkflowSync();
             setTimeout(() => propagateFromUnit(fromId), 20);
         }
    };

    const showEnhancementUnavailable = (unitId: string, feature: "OCR" | "Translation") => {
         const label = feature === "OCR" ? "OCR 识别" : "翻译";
         const message = `${label} 需要 ArtLoom 增强服务。请启动 ArtLoom，并通过联动模式运行 Hook。`;
         console.warn(message);
         uiActions.showEnhancementNotice(unitId, {
             feature,
             title: "增强功能未安装或未连接",
             message,
         });
    };

    const performOcrAction = async (unitId: string) => {
         const u = graphStore.units.find(u => u.id === unitId);
         if(u && u.data.src) {
             try {
                  const capabilities = await api.getEnhancementCapabilities();
                  if (!capabilities.ocr) {
                      showEnhancementUnavailable(unitId, "OCR");
                      return;
                  }
                  const res = await api.performOcr(u.data.src);
                  if(res.fullText && res.textBlocks) {
                      await navigator.clipboard.writeText(res.fullText);
                      graphStore.actions.updateUnitData(unitId, {
                          ocrResult: {
                              fullText: res.fullText,
                              textBlocks: res.textBlocks,
                              width: res.width,
                              height: res.height,
                              scaleFactor: res.scaleFactor,
                          }
                      });
                      syncService.performWorkflowSync();
                  }
             } catch(e) { console.error("OCR Error", e); }
         }
    };

    const toggleTranslationAction = async (unitId: string) => {
         const unit = graphStore.units.find(u => u.id === unitId);
         const ocrResult = unit?.data?.ocrResult;
         if (!unit || !ocrResult?.textBlocks?.length) {
             showEnhancementUnavailable(unitId, "Translation");
             return;
         }

         if (unit.data.showTranslated) {
             graphStore.actions.updateUnitData(unitId, { showTranslated: false });
             syncService.performWorkflowSync();
             return;
         }

         const untranslatedBlocks = ocrResult.textBlocks.filter((block) => !block.translatedText);
         if (untranslatedBlocks.length > 0) {
             const capabilities = await api.getEnhancementCapabilities();
             if (!capabilities.translation) {
                 showEnhancementUnavailable(unitId, "Translation");
                 return;
             }

             const targetLang =
                 typeof navigator !== "undefined" &&
                 typeof navigator.language === "string" &&
                 !navigator.language.toLowerCase().startsWith("zh")
                     ? "en"
                     : "zh";

             try {
                 const translatedBlocks = await Promise.all(
                     ocrResult.textBlocks.map(async (block) => ({
                         ...block,
                         translatedText:
                             block.translatedText ||
                             (await api.translateText(block.text, targetLang)),
                     })),
                 );
                 graphStore.actions.updateUnitData(unitId, {
                     ocrResult: {
                         ...ocrResult,
                         textBlocks: translatedBlocks,
                     },
                     showTranslated: true,
                 });
                 syncService.performWorkflowSync();
                 return;
             } catch (error) {
                 console.error("Translation Error", error);
                 showEnhancementUnavailable(unitId, "Translation");
                 return;
             }
         }

         graphStore.actions.updateUnitData(unitId, { showTranslated: true });
         syncService.performWorkflowSync();
    };

    return { handleParamChange, propagateFromUnit, handleDoubleClick, spawnConnectedNode, performOcrAction, toggleTranslationAction };
}
