import { api } from "../services/api";
import { graphStore } from "../store/graphStore";
import { shaderCache } from "../services/shaderCache";
import { syncService } from "../services/syncService";
import { resolveEffectiveNodeParams, resolveUnitExecutionInputImage } from "../services/graphImageResolution";
import { deriveUnitExecutionConfig } from "../services/nodeExecutionConfig";
import {
    DISABLED_PREFIX,
    PARAM_ui_resize,
    EXEC_PREFIX,
    EXEC_expanded,
    EXEC_upstreamDriven,
    EXEC_paramDriven,
    EXEC_listenUpstream,
    EXEC_notifyDownstream,
    EXEC_manualTrigger
} from "../constants";

export function useNodeParameters() {

    const handleParamChange = async (
        unitId: string,
        paramId: string,
        value: any,
        isFinal = false,
        triggerSource: "param" | "upstream" | "manual" = "param",
    ) => {
        // --- Handle UI Resize (Special Case) ---
        if (paramId === PARAM_ui_resize) {
            if (value && typeof value === 'object' && value.w && value.h) {
                console.log(`[UI Action] Resize unit ${unitId} to`, value);
                const unit = graphStore.units.find((candidate) => candidate.id === unitId);
                if (unit?.type === "sticker") {
                    graphStore.actions.resizeStickerFrame(unitId, {
                        x: unit.x,
                        y: unit.y,
                        w: value.w,
                        h: value.h,
                    });
                } else {
                    graphStore.actions.updateUnit(unitId, {
                        w: value.w,
                        h: value.h
                    });
                }
                syncService.updateBackendRects();
                syncService.performWorkflowSync();
            }
            return;
        }

        // --- Handle Execution Config Params (UI-only, no backend dispatch) ---
        if (paramId.startsWith(EXEC_PREFIX)) {
            // Initialize executionConfig if not present
            if (!graphStore.unitExecConfig[unitId]) {
                const unit = graphStore.units.find(u => u.id === unitId);
                const artCap = unit && graphStore.capabilities.find(c => c.id === unit.artId);
                const existingConfig = unit?.data?.executionConfig;

                graphStore.setUnitExecConfig(unitId, deriveUnitExecutionConfig({
                    capability: artCap || undefined,
                    explicitConfig: existingConfig,
                }));
            }

            // Update the specific field using path-based update (fine-grained reactivity)
            switch (paramId) {
                case EXEC_expanded:
                    graphStore.setUnitExecConfig(unitId, "__expanded", value);
                    break;
                case EXEC_upstreamDriven:
                    graphStore.setUnitExecConfig(unitId, "triggerMode", "upstreamDriven", value);
                    break;
                case EXEC_paramDriven:
                    graphStore.setUnitExecConfig(unitId, "triggerMode", "paramDriven", value);
                    break;
                case EXEC_listenUpstream:
                    graphStore.setUnitExecConfig(unitId, "propagation", "listenUpstream", value);
                    break;
                case EXEC_notifyDownstream:
                    graphStore.setUnitExecConfig(unitId, "propagation", "notifyDownstream", value);
                    break;
                case EXEC_manualTrigger:
                    // Manual trigger
                    console.log(`[Execution] Manual trigger for unit ${unitId}`);

                    // CHECK IF SHADER ART BEFORE CONTINUING
                    const unit = graphStore.units.find(u => u.id === unitId);
                    const caps = graphStore.capabilities;
                    const artCap = unit && caps.find(c => c.id === unit.artId);

                    if (artCap?.execution_type === 'shader') {
                         console.log(`[Execution] Shader Art Manual Trigger intercepted for ${unitId}`);
                         const executeShader = async () => {
                             if (!unit || !unit.artId) return;

                             if (!shaderCache.hasShaderCode(unit.artId)) {
                                 try {
                                     await shaderCache.prefetchShader(unit.artId);
                                 } catch (e) {
                                     console.error(`[Execution] Prefetch failed:`, e);
                                     return;
                                 }
                             }

                             const canvas = document.getElementById(`shader-canvas-${unitId}`) as HTMLCanvasElement;
                             if (canvas) {
                                 const renderer = shaderCache.getRenderer(unit.artId, unitId, canvas);
                                 if (renderer) {
                                     renderer.render();
                                     return;
                                 }
                             }
                         };
                         executeShader();
                         return; // STOP EXECUTION HERE
                    }

                    // For now, just trigger processing like before
                    graphStore.setUnitParams(unitId, (prev) => ({ ...(prev || {}), ["force_update"]: value }));
                    break;
            }

            // 2. MIRROR TO UNIT DATA & PERSIST
            // We must update unit.data.executionConfig so it's included in the sync snapshot
            const newConfig = { ...graphStore.unitExecConfig[unitId] };
            graphStore.actions.updateUnitData(unitId, { executionConfig: newConfig });

            // 3. SYNC TO BACKEND
            syncService.performWorkflowSync();

            if (paramId !== EXEC_manualTrigger) return;
        }

        const hasIncomingValueLink = graphStore.links.some(
            (link) => link.toUnitId === unitId && link.toPortId === paramId,
        );
        const shouldPersistManualParam = !(triggerSource === "upstream" && hasIncomingValueLink);

        // 1. Optimistic Update (UI Store). Upstream-linked updates are derived values,
        // so keep the manual fallback untouched and resolve the effective value later.
        if (shouldPersistManualParam) {
            graphStore.setUnitParams(unitId, (prev) => ({ ...(prev || {}), [paramId]: value }));

            if (isFinal) {
                 const unit = graphStore.units.find(u => u.id === unitId);
                 if (unit) {
                      // Important: Update the persisted logic.
                      graphStore.actions.updateUnit(unitId, { params: { ...unit.params, [paramId]: value } });
                 }
            }
        }

        // 3. Find the Unit and its Capability
        const unit = graphStore.units.find(u => u.id === unitId);
        if (!unit) return;

        const artId = unit.artId;
        const caps = graphStore.capabilities;
        const artCapability = caps.find(c => c.id === artId);

        // 4. Check execution config to decide if we should execute
        const execConfig = deriveUnitExecutionConfig({
            capability: artCapability,
            explicitConfig: graphStore.unitExecConfig[unitId] || unit.data?.executionConfig,
        });

        const isManualTrigger =
            paramId === "force_update" ||
            paramId === EXEC_manualTrigger ||
            triggerSource === "manual";
        const isUpstreamTrigger = triggerSource === "upstream";
        const isParamDriven = execConfig.triggerMode?.paramDriven ?? true;
        const isUpstreamDriven = execConfig.triggerMode?.upstreamDriven ?? true;

        if (!isManualTrigger) {
            if (isUpstreamTrigger) {
                if (!isUpstreamDriven) return;
            } else if (!isParamDriven) {
                return;
            }
        }

        // If param-driven but NOT final (dragging slider), SKIP backend execution
        // UNLESS it's a shader art
        if (!isFinal && !isManualTrigger && !isUpstreamTrigger) {
             if (artCapability?.execution_type !== 'shader') {
                return;
             }
        }

          // 4. Find Source Image (for Mock Processing)
          const inputImage = resolveUnitExecutionInputImage({
              units: graphStore.units,
              links: graphStore.links,
              capabilities: graphStore.capabilities,
              unitId,
          }) ?? null;

          // 5. Dispatch to Backend
          const manualParams = graphStore.unitParams[unitId] || {};
          const fullParams = resolveEffectiveNodeParams({
              units: graphStore.units,
              links: graphStore.links,
              capabilities: graphStore.capabilities,
              unitId,
              manualParams,
          });
          const effectiveValue = fullParams[paramId] ?? value;

          const disabledParams: string[] = [];
          const activeParams: Record<string, any> = {};

          Object.keys(manualParams).forEach(key => {
              if (manualParams[key] === DISABLED_PREFIX) {
                  disabledParams.push(key);
              }
          });

          Object.keys(fullParams).forEach(key => {
              if (fullParams[key] !== DISABLED_PREFIX) {
                  activeParams[key] = fullParams[key];
              }
          });

          // === SHADER ART LOCAL EXECUTION ===
          if (artCapability?.execution_type === 'shader' && artId) {
                const isLutParam = ['reference', 'recalculate'].includes(paramId);
                if (isManualTrigger || isLutParam) {
                    // Contextual shaders are refreshed by ShaderPreview with the current
                    // source/reference images. Do not dispatch them to the image backend,
                    // otherwise the backend pass-through can overwrite the WebGL result.
                }

                const canvas = document.getElementById(`shader-canvas-${unitId}`) as HTMLCanvasElement;
                if (canvas) {
                    const renderer = shaderCache.getRenderer(artId, unitId, canvas);
                    if (renderer) {
                        if (isManualTrigger) {
                     renderer.render(); return;
                        }
                        const paramDef = artCapability.params.find(p => p.id === paramId);
                        if (isUpstreamTrigger || isLutParam || !paramDef) {
                            renderer.render();
                        } else if (paramDef) {
                            try {
                                renderer.setUniform(paramId, effectiveValue);
                                renderer.render();
                                if (!isFinal) return;
                            } catch (e) {
                                console.error(`[Shader] Render failed:`, e);
                            }
                        }
                    }
                }
                void syncService.performWorkflowSync();
                return;
          }

          // Dispatch Action
          try {
            await api.dispatchAction({
                     action: "update_node_param",
                     payload: {
                         node_id: unitId,
                         param_key: paramId,
                         value: effectiveValue,
                         input_image: inputImage,
                         art_id: artId,
                         all_params: activeParams,
                         disabled_params: disabledParams,
                         origin_workflow_id: unit.data?.originWorkflowId,
                         origin_node_id: unit.data?.originNodeId
                     }
            });

          } catch (e) {
              console.error("Failed to update param:", e);
          }
    };

    return { handleParamChange };
}
