import { api } from "../services/api";
import { graphStore } from "../store/graphStore";
import { syncService } from "../services/syncService";
import { logger } from "../services/logger";
import {
    selectedStickerId,
    selectionActions,
    setDraggingStickerId,
    setMultiDragPositions,
    uiActions,
} from "../store/uiStore";
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
import { resolveUnitImageDataUrl } from "../services/unitImageSource";
import { MAX_OCR_BLOCKS } from "../services/ocrOverlayLayout";
import { showOcrCopyNotice } from "../services/ocrCopyNotice";
import { copyOcrTextToClipboard } from "../services/ocrOverlayInteraction";
import { buildBarcodeOutputValues } from "../services/barcodeRecognition";
import { registerBarcodePropagation } from "../services/barcodeResultActions";

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
    const barcodeOperationTokens = new Map<string, number>();
    const ocrOperationTokens = new Map<string, number>();

    const startOperation = (tokens: Map<string, number>, unitId: string) => {
        const token = (tokens.get(unitId) ?? 0) + 1;
        tokens.set(unitId, token);
        return token;
    };

    const isCurrentOperation = (
        tokens: Map<string, number>,
        unitId: string,
        token: number,
        source: { src?: string; filePath?: string },
    ) => {
        const unit = graphStore.units.find((candidate) => candidate.id === unitId);
        return tokens.get(unitId) === token &&
            !!unit &&
            unit.data.src === source.src &&
            unit.data.filePath === source.filePath;
    };

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
    const spawnConnectedNode = (fromId: string, artId: string): string | null => {
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
    };

    const showEnhancementUnavailable = (unitId: string, feature: "OCR" | "Translation") => {
         const label = feature === "OCR" ? "OCR 识别" : "翻译";
         const message = `${label} 需要 Loom Hook 增强服务。请启动 Loom Hook，并通过联动模式运行 Hook。`;
         console.warn(message);
         uiActions.showEnhancementNotice(unitId, {
             feature,
             title: "增强功能未安装或未连接",
             message,
         });
    };

    const showOcrFailure = (unitId: string, message: string) => {
         console.warn(`OCR failed: ${message}`);
         uiActions.showEnhancementNotice(unitId, {
             feature: "OCR",
             title: "OCR 识别失败",
             message,
         });
    };

    const performBarcodeAction = async (unitId: string) => {
         const unit = graphStore.units.find(candidate => candidate.id === unitId);
         if (!unit?.data.src) return;
         const source = { src: unit.data.src, filePath: unit.data.filePath };
         const operationToken = startOperation(barcodeOperationTokens, unitId);

         try {
             const imageDataUrl = await resolveUnitImageDataUrl(
                 source,
                 { readImageFromPath: api.readImageFromPath },
             );
             const decoded = await api.decode(imageDataUrl);
             const scan = decoded.results.length > 0 && !decoded.selectedId
                 ? { ...decoded, selectedId: decoded.results[0].id }
                 : decoded;
             const latestUnit = graphStore.units.find(candidate => candidate.id === unitId);
             if (!latestUnit || !isCurrentOperation(barcodeOperationTokens, unitId, operationToken, source)) return;
             graphStore.actions.updateUnitData(unitId, {
                 barcodeResult: scan,
                 outputs: {
                     ...latestUnit.data.outputs,
                     ...buildBarcodeOutputValues(scan),
                 },
             });
             syncService.performWorkflowSync();
             if (scan.results.length > 0) {
                 queueMicrotask(() => propagateFromUnit(unitId));
                 uiActions.showEnhancementNotice(unitId, {
                     feature: "Barcode",
                     title: "二维码/条码识别完成",
                     message: `识别到 ${scan.results.length} 个码，可在属性面板查看并连接到 Art。`,
                 });
             }
         } catch (error) {
             console.warn("Barcode recognition failed", error);
             uiActions.showEnhancementNotice(unitId, {
                 feature: "Barcode",
                 title: "二维码/条码识别失败",
                 message: "无法读取图片或执行本地解码，请确认图片清晰后重试。",
             });
         }
    };

    const performOcrAction = async (unitId: string) => {
         const u = graphStore.units.find(u => u.id === unitId);
         if (!u) return;
         uiActions.clearOcrInteractiveUnit(unitId);
         if (!u.data.src) {
             showOcrFailure(unitId, "所选贴图没有可识别的图片内容。");
             return;
         }
         const source = { src: u.data.src, filePath: u.data.filePath };
         const operationToken = startOperation(ocrOperationTokens, unitId);

         // Keep QR/barcode decoding local and independent from Loom OCR. A Loom
         // outage must not prevent a captured code from being recognized.
         void performBarcodeAction(unitId);

         try {
              const capabilities = await api.getEnhancementCapabilities();
              if (!isCurrentOperation(ocrOperationTokens, unitId, operationToken, source)) return;
              if (!capabilities.ocr) {
                  showEnhancementUnavailable(unitId, "OCR");
                  return;
              }

              // Region capture responses are file-backed asset URLs. Resolve
              // them through the bounded native reader before crossing Loom's
              // data-URL-only OCR protocol boundary.
              const imageDataUrl = await resolveUnitImageDataUrl(
                  source,
                  { readImageFromPath: api.readImageFromPath },
              );
              const res = await api.performOcr(imageDataUrl);
              if (!isCurrentOperation(ocrOperationTokens, unitId, operationToken, source)) return;
              const response = res as typeof res & { text?: unknown };
              const textBlocks = Array.isArray(response.textBlocks)
                  ? response.textBlocks.slice(0, MAX_OCR_BLOCKS)
                  : [];
              const blockText = textBlocks
                  .map((block) => typeof block?.text === "string" ? block.text : "")
                  .filter(Boolean)
                  .join("\n");
              const fullTextCandidate = typeof response.fullText === "string"
                  ? response.fullText.trim()
                  : typeof response.text === "string"
                      ? response.text.trim()
                      : "";
              const fullText = fullTextCandidate || blockText.trim();
              if (!fullText) {
                  showOcrFailure(unitId, "未识别到可复制的文本，请确认图片清晰且包含文字。");
                  return;
              }

              // Persist and render the OCR result before attempting clipboard
              // access. Clipboard permission/focus failures must not discard a
              // successful recognition result.
              graphStore.actions.updateUnitData(unitId, {
                  ocrResult: {
                      fullText,
                      textBlocks,
                      width: res.width,
                      height: res.height,
                      scaleFactor: res.scaleFactor,
                  },
                  hideOcr: false,
              });
              // Ctrl+2 owns a separate native command path from Alt+2. Restore
              // interaction here as well, but never steal a newer selection from
              // a slow OCR request that completed in the background.
              const selectedUnitId = selectedStickerId();
              if (!selectedUnitId) selectionActions.set([unitId]);
              if (!selectedUnitId || selectedUnitId === unitId) {
                  uiActions.setOcrInteractiveUnit(unitId);
                  queueMicrotask(() => void syncService.updateBackendRects());
              }
              syncService.performWorkflowSync();

              if (!isCurrentOperation(ocrOperationTokens, unitId, operationToken, source)) return;
              const copied = await copyOcrTextToClipboard(fullText);
              if (!isCurrentOperation(ocrOperationTokens, unitId, operationToken, source)) return;
              showOcrCopyNotice(unitId, fullText, copied, "full");
         } catch (error) {
             if (!isCurrentOperation(ocrOperationTokens, unitId, operationToken, source)) return;
             console.error("OCR Error", error);
             showOcrFailure(unitId, "无法读取图片或连接 Loom Hook，请确认 Loom 已启动后重试。");
         }
    };

    const toggleOcrAction = async (unitId: string) => {
         const unit = graphStore.units.find(candidate => candidate.id === unitId);
         if (!unit) return;
         uiActions.clearOcrInteractiveUnit(unitId);
         if (!unit.data.ocrResult) {
             await performOcrAction(unitId);
             return;
         }
         graphStore.actions.updateUnitData(unitId, { hideOcr: !unit.data.hideOcr });
         syncService.performWorkflowSync();
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

             const interfaceLanguage = typeof document !== "undefined"
                 ? document.documentElement.lang
                 : typeof navigator !== "undefined"
                     ? navigator.language
                     : "zh-Hans";
             const targetLang =
                 typeof interfaceLanguage === "string" &&
                 !interfaceLanguage.toLowerCase().startsWith("zh")
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

    registerBarcodePropagation(propagateFromUnit);

    return {
        handleParamChange,
        propagateFromUnit,
        handleDoubleClick,
        spawnConnectedNode,
        performOcrAction,
        performBarcodeAction,
        toggleOcrAction,
        toggleTranslationAction,
    };
}
