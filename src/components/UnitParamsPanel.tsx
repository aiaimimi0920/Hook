
import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Unit, Link } from "../types/unit";
import { ArtCapability, ArtParam } from "../services/protocol";
import { updatePortOffset, addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { UnitActionsMenu } from "./UnitActionsMenu";
import { UnitParamControl } from "./params/UnitParamControl";
import { graphStore } from "../store/graphStore";
import { setLayoutTick } from "../store/uiStore";
import {
    buildArtParamGroups,
    shouldGroupArtParams,
} from "../services/artParamGrouping";
import { getCapabilityInputsForPorts } from "../services/artPorts";
import { normalizeImageSourceForDisplay } from "../services/imageSource";
import { resolveEffectiveNodeParams } from "../services/graphImageResolution";
import { syncService } from "../services/syncService";
import { api } from "../services/api";
import {
    buildOptimisticCandidateSelectionPatch,
    resolveCandidateCardPreviewSrc,
} from "../services/artCandidateCache";
import {
    DISABLED_PREFIX,
    PARAM_ui_resize,
    EXEC_expanded,
    EXEC_manualTrigger,
    EXEC_upstreamDriven,
    EXEC_paramDriven,
    EXEC_listenUpstream,
    EXEC_notifyDownstream
} from "../constants";

interface UnitParamsPanelProps {
  unit: Unit;
  params: Record<string, any>; // Reactive
  execConfig?: {
      triggerMode: { upstreamDriven: boolean; paramDriven: boolean };
      propagation: { listenUpstream: boolean; notifyDownstream: boolean };
      __expanded: boolean;
  };
  capability?: ArtCapability;
  connectedLinks?: Link[];
  resolveUnitImage?: (unitId: string) => string | undefined;

  onParamChange: (propId: string, value: any, isFinal?: boolean) => void;
  onLinkStart: (propId: string, startX: number, startY: number) => void;
  onLinkDrop: (propId: string) => void;
  onLinkHover: (targetId: string | null) => void;
  onLinkMove?: (portId: string, e: MouseEvent) => void; // Optional

  // Passthrough for Add Node logic in Actions Menu (if we keep Actions Menu here)
  onAddNode: (artId: string) => void;
  availableArts?: ArtCapability[];
}

// Global scroll state
const globalScrollRegistry: Record<string, number> = {};

export const UnitParamsPanel: Component<UnitParamsPanelProps> = (props) => {
  let paramContainerRef: HTMLDivElement | undefined;
  let scrollContainerRef: HTMLDivElement | undefined;
  let scrollTrackRef: HTMLDivElement | undefined;
  let settingsPanelRef: HTMLDivElement | undefined;

  const [editingTextId, setEditingTextId] = createSignal<string | null>(null);
  const [tempText, setTempText] = createSignal<string>("");
  const [hoveringParam, setHoveringParam] = createSignal<string | null>(null);
  const [draggingSlider, setDraggingSlider] = createSignal<{ id: string; value: number } | null>(null);
  const [scrollMetrics, setScrollMetrics] = createSignal({
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
      trackHeight: 0,
  });
  let scrollThumbDragCleanup: (() => void) | undefined;

  const isArt = () => props.unit.type === 'art';
  const acceptsUpstreamStickerEditPropagation = () =>
      props.unit.data.stickerEditPropagation?.acceptUpstream ?? true;
  const setAcceptsUpstreamStickerEditPropagation = (acceptUpstream: boolean) => {
      graphStore.actions.updateUnitData(props.unit.id, {
          stickerEditPropagation: {
              ...props.unit.data.stickerEditPropagation,
              acceptUpstream,
          },
      });
      void syncService.performWorkflowSync();
  };

  // --- Helpers ---
  const isParamLinked = (paramId: string) => !!props.connectedLinks?.some((link) => link.toPortId === paramId);
  const effectiveParams = createMemo(() =>
      resolveEffectiveNodeParams({
          units: graphStore.units,
          links: graphStore.links,
          capabilities: graphStore.capabilities,
          unitId: props.unit.id,
          manualParams: props.params,
      }),
  );

  const getParamValue = (paramId: string, defaultVal: any) => {
      const val = props.params[paramId];
      if (val === DISABLED_PREFIX) return defaultVal;
      if (isParamLinked(paramId)) return effectiveParams()[paramId] ?? defaultVal;
      const dragging = draggingSlider();
      if (dragging && dragging.id === paramId) return dragging.value;
      return val ?? defaultVal;
  };

  const getInputs = () => {
       if (!isArt()) {
            return [{ name: "image", label: "Image", type: "image", description: "Input image source" }];
       }
       if (props.capability?.inputs) return getCapabilityInputsForPorts(props.capability);
       return [{ name: "input_image", label: "Input", type: "image" }];
  };

  const getOutputs = () => {
       if (!isArt()) {
            return [{ name: "output_image", label: "Image", type: "image" }];
       }
       if (props.capability?.outputs) return props.capability.outputs;
       return [{ name: "output_image", label: "Image", type: "image" }];
  };

  const derivedParams = () => {
      if (isArt()) return props.capability?.params || [];
      return [];
  };
  const paramGroups = createMemo(() => buildArtParamGroups(derivedParams()));
  const hoveringDataUrlPreview = createMemo(() => {
      const paramId = hoveringParam();
      if (!paramId) return null;
      const value = props.params[paramId];
      return typeof value === "string" && value.startsWith("data:") ? value : null;
  });

  const displaySrc = () => {
      let resolvedSrc: string | undefined;
      if (!isArt()) {
          const isImageDisabled = props.unit.params["image"] === DISABLED_PREFIX;
          if (!isImageDisabled) {
              const imageInput = getInputs().find(i => i.name === 'image');
              if (imageInput && props.connectedLinks) {
                   const link = props.connectedLinks.find(l => l.toPortId === imageInput.name);
                   if (link && props.resolveUnitImage) {
                       const src = props.resolveUnitImage(link.fromUnitId);
                       if (src) {
                           resolvedSrc = src;
                       }
                   }
              }
              const path = props.params.image_path;
              if (path && path.startsWith("data:")) {
                  resolvedSrc = path;
              }
          }
      }
      if (!resolvedSrc) {
          resolvedSrc = props.unit.data.previewSrc || props.unit.data.src || "";
      }
      return normalizeImageSourceForDisplay(resolvedSrc) || "";
  };
  const resultCandidates = () => props.unit.data.resultCandidates || [];
  const candidateSetSignature = createMemo(() =>
      resultCandidates()
          .map(
              (candidate) =>
                  `${candidate.index}:${candidate.imageUrl}:${candidate.thumbnail || ""}:${candidate.preview || ""}:${candidate.thumbnailUrl || ""}`,
          )
          .join("|"),
  );
  const [candidateFallbackSrcs, setCandidateFallbackSrcs] =
      createSignal<Record<number, string>>({});
  const candidatePreviewFallbacksInFlight = new Set<number>();
  createEffect(() => {
      candidateSetSignature();
      candidatePreviewFallbacksInFlight.clear();
      setCandidateFallbackSrcs({});
  });
  const selectedResultIndex = () => {
      const runtimeSelected = props.unit.data.selectedResultIndex;
      if (typeof runtimeSelected === "number" && Number.isFinite(runtimeSelected)) {
          return runtimeSelected;
      }
      const paramSelected = props.params.result_index;
      return typeof paramSelected === "number" && Number.isFinite(paramSelected)
          ? Math.floor(paramSelected)
          : undefined;
  };
  const selectCandidate = (candidate: ReturnType<typeof resultCandidates>[number]) => {
      graphStore.actions.updateUnitData(
          props.unit.id,
          buildOptimisticCandidateSelectionPatch(props.unit, candidate),
      );
      props.onParamChange("result_index", candidate.index, false);
      props.onParamChange("force_update", Date.now(), true);
  };
  const setCandidateFallbackSrc = (candidateIndex: number, src: string) => {
      setCandidateFallbackSrcs((prev) =>
          prev[candidateIndex] === src
              ? prev
              : {
                    ...prev,
                    [candidateIndex]: src,
                },
      );
  };
  const resolveCandidateFallbackPath = (
      candidate: ReturnType<typeof resultCandidates>[number],
  ) => candidate.cachedThumbnailPath || candidate.cachedImagePath;
  const handleCandidatePreviewError = async (
      candidate: ReturnType<typeof resultCandidates>[number],
  ) => {
      const candidateIndex = candidate.index;
      const selectedPreviewSrc =
          candidateIndex === selectedResultIndex()
              ? normalizeImageSourceForDisplay(props.unit.data.previewSrc)
              : undefined;
      if (selectedPreviewSrc) {
          setCandidateFallbackSrc(candidateIndex, selectedPreviewSrc);
      }

      const fallbackPath = resolveCandidateFallbackPath(candidate);
      if (!fallbackPath || candidatePreviewFallbacksInFlight.has(candidateIndex)) {
          return;
      }

      candidatePreviewFallbacksInFlight.add(candidateIndex);
      try {
          const fallbackSrc = await api.readImageFromPath(fallbackPath);
          setCandidateFallbackSrc(candidateIndex, fallbackSrc);
      } catch (error) {
          console.warn(
              "[UnitParamsPanel] Failed to load candidate thumbnail fallback",
              candidateIndex,
              error,
          );
      } finally {
          candidatePreviewFallbacksInFlight.delete(candidateIndex);
      }
  };

  const isPortVisible = (portName: string) => {
      const userVis = props.unit.data.portVisibility?.[portName];
      if (typeof userVis === 'boolean') return userVis;
      const inputDef = props.capability?.inputs?.find(p => p.name === portName);
      if (inputDef && inputDef.defaultVisible !== undefined) return inputDef.defaultVisible;
      const outputDef = props.capability?.outputs?.find(p => p.name === portName);
      if (outputDef && outputDef.defaultVisible !== undefined) return outputDef.defaultVisible;
      return true;
  };

  const togglePortVisibility = (portName: string) => {
      const current = isPortVisible(portName);
      const newMap = { ...props.unit.data.portVisibility, [portName]: !current };
      graphStore.actions.updateUnitData(props.unit.id, { portVisibility: newMap });
  };

  const toggleParamDisabled = (paramId: string) => {
      const currentVal = props.params[paramId];
      const isCurrentlyDisabled = currentVal === DISABLED_PREFIX;

      if (isCurrentlyDisabled) {
          const stash = props.unit.data.disabledParamValues || {};
          const originalVal = stash[paramId];
          const capabilityParam = props.capability?.params.find(p => p.id === paramId);
          const fallback = capabilityParam?.default ?? "";
          const restoreVal = originalVal !== undefined ? originalVal : fallback;
          props.onParamChange(paramId, restoreVal);
      } else {
          const stash = props.unit.data.disabledParamValues || {};
          const newStash = { ...stash, [paramId]: currentVal };
          graphStore.actions.updateUnitData(props.unit.id, { disabledParamValues: newStash });
          props.onParamChange(paramId, DISABLED_PREFIX);
      }
  };

  const openTextEditor = (param: ArtParam) => {
      setTempText(String(getParamValue(param.id, param.default) ?? ""));
      setEditingTextId(param.id);
  };

  const focusOverlayFromPointerEvent = (event: PointerEvent | MouseEvent) => {
      event.stopPropagation();
      void api.focusOverlayWindow();
  };

  const syncScrollMetrics = () => {
      if (!scrollContainerRef) return;
      const trackHeight =
          scrollTrackRef?.clientHeight ||
          scrollTrackRef?.getBoundingClientRect().height ||
          scrollContainerRef.clientHeight;
      setScrollMetrics({
          scrollTop: scrollContainerRef.scrollTop,
          scrollHeight: scrollContainerRef.scrollHeight,
          clientHeight: scrollContainerRef.clientHeight,
          trackHeight,
      });
  };

  const getMaxScrollTop = () =>
      Math.max(0, scrollMetrics().scrollHeight - scrollMetrics().clientHeight);

  const setManualScrollTop = (nextScrollTop: number) => {
      if (!scrollContainerRef) return;
      const maxScrollTop = Math.max(0, scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight);
      const clampedScrollTop = Math.max(0, Math.min(nextScrollTop, maxScrollTop));
      scrollContainerRef.scrollTop = clampedScrollTop;
      globalScrollRegistry[props.unit.id] = clampedScrollTop;
      syncScrollMetrics();
  };

  const applyManualScrollDelta = (deltaY: number) => {
      const currentScrollTop = scrollContainerRef?.scrollTop ?? scrollMetrics().scrollTop;
      setManualScrollTop(currentScrollTop + deltaY);
  };

  const hasScrollableOverflow = () => scrollMetrics().scrollHeight > scrollMetrics().clientHeight + 1;

  const getScrollTrackHeight = () => {
      const metrics = scrollMetrics();
      return metrics.trackHeight > 0 ? metrics.trackHeight : metrics.clientHeight;
  };

  const getScrollThumbHeight = () => {
      const metrics = scrollMetrics();
      const trackHeight = getScrollTrackHeight();
      if (trackHeight <= 0 || metrics.clientHeight <= 0 || metrics.scrollHeight <= 0) return 0;
      if (!hasScrollableOverflow()) return trackHeight;
      return Math.min(
          trackHeight,
          Math.max(18, (metrics.clientHeight / metrics.scrollHeight) * trackHeight),
      );
  };

  const getScrollThumbTravel = () =>
      Math.max(0, getScrollTrackHeight() - getScrollThumbHeight());

  const getScrollThumbTop = () => {
      const maxScrollTop = getMaxScrollTop();
      if (maxScrollTop <= 0) return 0;
      return (scrollMetrics().scrollTop / maxScrollTop) * getScrollThumbTravel();
  };

  const clearScrollThumbDrag = () => {
      scrollThumbDragCleanup?.();
      scrollThumbDragCleanup = undefined;
  };

  const startScrollThumbDrag = (event: MouseEvent & { currentTarget: HTMLDivElement }) => {
      event.preventDefault();
      event.stopPropagation();
      void api.focusOverlayWindow();

      const dragStartClientY = event.clientY;
      const dragStartScrollTop = scrollContainerRef?.scrollTop ?? scrollMetrics().scrollTop;
      const maxScrollTop = getMaxScrollTop();
      const thumbTravel = getScrollThumbTravel();
      if (!scrollContainerRef || maxScrollTop <= 0 || thumbTravel <= 0) {
          return;
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
          moveEvent.preventDefault();
          const deltaY = moveEvent.clientY - dragStartClientY;
          const scrollDelta = (deltaY / thumbTravel) * maxScrollTop;
          setManualScrollTop(dragStartScrollTop + scrollDelta);
      };

      const handleMouseUp = () => {
          clearScrollThumbDrag();
      };

      clearScrollThumbDrag();
      window.addEventListener("mousemove", handleMouseMove, true);
      window.addEventListener("mouseup", handleMouseUp, true);
      scrollThumbDragCleanup = () => {
          window.removeEventListener("mousemove", handleMouseMove, true);
          window.removeEventListener("mouseup", handleMouseUp, true);
      };
  };

  const handleScrollTrackMouseDown = (event: MouseEvent & { currentTarget: HTMLDivElement }) => {
      event.preventDefault();
      event.stopPropagation();
      void api.focusOverlayWindow();
      if (!scrollContainerRef) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.height <= 0) return;
      const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      setManualScrollTop(ratio * getMaxScrollTop());
  };

  const handleParamChange = (id: string, val: any, isFinal: boolean = true) => {
      // Handle local dragging state optimization
      if (!isFinal && typeof val === 'number') {
          setDraggingSlider({ id, value: val });
      } else {
           if (draggingSlider()?.id === id) {
               setDraggingSlider(null);
           }
      }
      props.onParamChange(id, val, isFinal);
  };

  const renderParamControl = (param: ArtParam) => (
      <UnitParamControl
          param={param}
          value={getParamValue(param.id, param.default)}
          isDisabled={props.params[param.id] === DISABLED_PREFIX || isParamLinked(param.id)}
          isLinked={isParamLinked(param.id)}
          onChange={handleParamChange}
          onToggleDisable={(id) => toggleParamDisabled(id)}
          onReset={(id, def) => props.onParamChange(id, def)}
          onLinkStart={props.onLinkStart}
          onLinkDrop={props.onLinkDrop}
          onLinkMove={props.onLinkMove}
          onLinkHover={props.onLinkHover}
          registerLinkTarget={(el) => registerPanelPort(el, param.id)}
          onEditStart={() => openTextEditor(param)}
          onPreview={(id, active) => setHoveringParam(active ? id : null)}
      />
  );

  const registerPanelPort = (el: HTMLElement, portName: string) => {
      const update = () => {
          if (!el.isConnected) return;
          const unit = el.closest('.unit-container');
          if (!unit) return;
          const rPort = el.getBoundingClientRect();
          const rUnit = unit.getBoundingClientRect();
          const relX = (rPort.left + rPort.width/2) - rUnit.left;
          const relY = (rPort.top + rPort.height/2) - rUnit.top;
          if (isNaN(relX) || isNaN(relY)) return;
          updatePortOffset(props.unit.id, portName, {x: relX, y: relY});
      };
      update();
      requestAnimationFrame(update);
      setTimeout(update, 50);
  };

  // --- Effects ---

  // Clear dragging state if external update matches
  createEffect(() => {
      const dragging = draggingSlider();
      if (dragging) {
          const currentVal = props.params[dragging.id];
          if (typeof currentVal === "number" && Math.abs(currentVal - dragging.value) < 0.001) {
              setDraggingSlider(null);
          }
      }
  });

  // Sync tempText
  createEffect(() => {
      const id = editingTextId();
      if (!id) return;
      const param = derivedParams().find((item) => item.id === id);
      setTempText(String(getParamValue(id, param?.default) ?? ""));
  });

  createEffect(() => {
      derivedParams().length;
      paramGroups().length;
      candidateSetSignature();
      requestAnimationFrame(() => syncScrollMetrics());
  });

  // Rect Registration for Panel
  createEffect(() => {
       const u = props.unit;
       // 1. Params Panel (Bottom Center)
       const updateParamsRect = () => {
           if (paramContainerRef && paramContainerRef.isConnected) {
               const rect = paramContainerRef.getBoundingClientRect();
               const scale = rect.width > 0 ? rect.width / 250 : 1;
               const worldHeight = rect.height / scale;

               addOrUpdateRect({
                   id: `params-${u.id}`,
                   x: u.x + (u.w / 2) - (250 / 2) - 50,
                   y: u.y + u.h + 12,
                   width: 250 + 100,
                   height: worldHeight,
                   name: "PARAMS_PANEL"
               });
           }
       };

       updateParamsRect();
       let observer: ResizeObserver | null = null;
       if (paramContainerRef) {
           observer = new ResizeObserver(() => {
               updateParamsRect();
               syncScrollMetrics();
           });
           observer.observe(paramContainerRef);
       }
       onCleanup(() => {
           observer?.disconnect();
           removeRect(`params-${u.id}`);
       });
  });

  onMount(() => {
      syncScrollMetrics();
      const rafId = requestAnimationFrame(() => syncScrollMetrics());

      let scrollContainerObserver: ResizeObserver | null = null;
      let scrollContentObserver: ResizeObserver | null = null;
      let scrollTrackObserver: ResizeObserver | null = null;

      if (typeof ResizeObserver !== "undefined" && scrollContainerRef) {
          scrollContainerObserver = new ResizeObserver(() => syncScrollMetrics());
          scrollContainerObserver.observe(scrollContainerRef);

          const scrollContent = scrollContainerRef.firstElementChild;
          if (scrollContent instanceof HTMLElement) {
              scrollContentObserver = new ResizeObserver(() => syncScrollMetrics());
              scrollContentObserver.observe(scrollContent);
          }

          if (scrollTrackRef) {
              scrollTrackObserver = new ResizeObserver(() => syncScrollMetrics());
              scrollTrackObserver.observe(scrollTrackRef);
          }
      }

      const handleWindowResize = () => syncScrollMetrics();
      window.addEventListener("resize", handleWindowResize);

      onCleanup(() => {
          cancelAnimationFrame(rafId);
          window.removeEventListener("resize", handleWindowResize);
          scrollContainerObserver?.disconnect();
          scrollContentObserver?.disconnect();
          scrollTrackObserver?.disconnect();
          clearScrollThumbDrag();
      });
  });



  // 3. Text Editor Rect
  createEffect(() => {
      const u = props.unit;
      const x = u.x + u.w + 12;
      const editorId = editingTextId();
      if (editorId) {
          addOrUpdateRect({
              id: `editor-${u.id}`,
              x: x + 250 + 12,
              y: u.y,
              width: 200,
              height: 250,
              name: "TEXT_EDITOR"
          });
      } else {
          removeRect(`editor-${u.id}`);
      }
  });

  // 4. Expanded Settings Panel Rect
  createEffect(() => {
      const u = props.unit;
      const isExpanded = props.execConfig?.__expanded;

      const updateExecRect = () => {
           if (isExpanded && settingsPanelRef && settingsPanelRef.isConnected) {
               const rect = settingsPanelRef.getBoundingClientRect();
               // We need global coordinates.
               // Unit is at u.x, u.y relative to canvas (if zoomed?)
               // But rect matches DOM.
               // The `addOrUpdateRect` expects Canvas Coordinates?
               // Wait, `u.x` is used in other stats.
               // Let's rely on the CSS Logic calculation which is consistent with other panels
               // OR measure relative to paramContainer if possible?
               // Actually, using the logic from `params-panel` (lines 194-204) is safer if we want to trust the render.
               // But `params-panel` uses getBoundingClientRect and then normalizes by zoom?

               // Let's stick to the calculation logic but use the Measured Height.
               // The CSS top/left are relative to Unit.

               // Re-calculate the strict position to match CSS:
               // left: "50%" -> u.w / 2
               // plus 125 + 8
               const x = u.x + (u.w / 2) + 125 + 8;
               const y = u.y + u.h + 12;

               // Measure Height from DOM
               // Note: If the canvas is zoomed, getBoundingClientRect returns scaled values.
               // We need unscaled height.
               // We can get clientHeight (which matches unscaled pixels usually? No, it's inner height).
               // offsetHeight is strictly integer.
               // Let's try to derive scale from unit width if possible, or just assume 1 if we can't find better.
               // UnitParamsPanel Logic (line 195): const scale = rect.width > 0 ? rect.width / 250 : 1;
               // Here width is 180.
               const scale = rect.width > 0 ? rect.width / 180 : 1;
               const worldHeight = rect.height / scale;

               addOrUpdateRect({
                  id: `exec-settings-${u.id}`,
                  x: x,
                  y: y,
                  width: 180,
                  height: worldHeight + 20, // Add buffer just in case
                  name: "EXEC_SETTINGS"
               });
           }
      };

      if (isExpanded) {
           // Initial update
           requestAnimationFrame(updateExecRect);

           // Observer
           let observer: ResizeObserver | null = null;
           if (settingsPanelRef) {
               observer = new ResizeObserver(() => updateExecRect());
               observer.observe(settingsPanelRef);
           }

           onCleanup(() => {
               observer?.disconnect();
               removeRect(`exec-settings-${u.id}`);
           });
      } else {
          removeRect(`exec-settings-${u.id}`);
      }
  });


  // Render
  return (
    <>
    <div
        ref={paramContainerRef}
        id={`params-panel-${props.unit.id}`}
        class="absolute flex flex-col z-[100] pointer-events-auto"
        style={{
            position: "absolute",
            left: "50%",
            "margin-left": "-125px",
            top: "100%",
            "margin-top": "12px",
            width: "250px",
            "height": "auto",
            "max-height": "min(560px, calc(100vh - 96px))",
            "overflow": "visible",
            "background": "transparent",
            "padding": "0",
            "z-index": 100,
            "pointer-events": "auto"
        }}
        onPointerDown={focusOverlayFromPointerEvent}
        onMouseDown={focusOverlayFromPointerEvent}
        onMouseUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
    >
        {/* Background */}
        <div
            class="hook-terminal-shell hook-terminal-shell--strong absolute inset-0 z-[-5] pointer-events-none"
        />

        <UnitActionsMenu
            unitId={props.unit.id}
            isArt={props.unit.type === 'art'}
            label={props.capability?.label}
            expanded={props.execConfig?.__expanded ?? false}
            onToggleExpand={() => {
                const currentExpanded = props.execConfig?.__expanded ?? false;
                props.onParamChange(EXEC_expanded, !currentExpanded);
            }}
            onManualTrigger={() => {
                props.onParamChange(EXEC_manualTrigger, Date.now());
            }}
        />

        <Show when={isArt() && resultCandidates().length > 1}>
            <div class="flex-shrink-0 px-4 pb-3">
                <div class="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-white/55">
                    <span>候选</span>
                    <span>
                        当前
                        {" "}
                        #
                        {(selectedResultIndex() ?? 0) + 1}
                    </span>
                </div>
                <div
                    class="mt-2 grid gap-2"
                    style={{
                        "grid-template-columns": "repeat(auto-fit, minmax(68px, 1fr))",
                    }}
                >
                    <For each={resultCandidates()}>
                        {(candidate) => {
                            const selected = () =>
                                candidate.index === selectedResultIndex();
                            const previewSrc = () =>
                                candidateFallbackSrcs()[candidate.index] ||
                                resolveCandidateCardPreviewSrc(candidate, {
                                    isSelected: selected(),
                                    selectedPreviewSrc: props.unit.data.previewSrc,
                                });
                            return (
                                <button
                                    type="button"
                                    data-art-candidate-index={candidate.index}
                                    data-image-search-candidate-index={candidate.index}
                                    class="flex flex-col gap-1 rounded-lg border bg-white/[0.03] p-1.5 text-left transition-colors hover:bg-white/[0.08]"
                                    style={{
                                        border: selected()
                                            ? "1px solid rgba(163, 230, 53, 0.9)"
                                            : "1px solid rgba(255, 255, 255, 0.1)",
                                        "box-shadow": selected()
                                            ? "0 0 0 1px rgba(163, 230, 53, 0.25)"
                                            : "none",
                                    }}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        selectCandidate(candidate);
                                    }}
                                >
                                    <span
                                        class="overflow-hidden rounded-md border border-white/10 bg-black/25"
                                        style={{
                                            width: "100%",
                                            height: "54px",
                                        }}
                                    >
                                        <img
                                            src={previewSrc()}
                                            alt={candidate.title || `候选 ${candidate.index + 1}`}
                                            loading="lazy"
                                            onError={() => {
                                                void handleCandidatePreviewError(candidate);
                                            }}
                                            style={{
                                                width: "100%",
                                                height: "100%",
                                                "object-fit": "cover",
                                                display: "block",
                                            }}
                                        />
                                    </span>
                                    <span class="truncate text-[10px] font-semibold text-white/85">
                                        {candidate.title || `候选 ${candidate.index + 1}`}
                                    </span>
                                    <span class="text-[9px] text-white/45">
                                        #{candidate.index + 1}
                                    </span>
                                </button>
                            );
                        }}
                    </For>
                </div>
                <div class="mt-2 h-px bg-white/5" />
            </div>
        </Show>

        {/* Inputs */}
        <Show when={getInputs().length > 0}>
             <div class="flex-shrink-0 flex flex-col gap-2 p-4 pb-2 relative">
                 <For each={getInputs()}>
                    {(input) => {
                        const isDisabled = () => props.params[input.name] === DISABLED_PREFIX;
                        // ... render input row ...
                        return (
                            <div class="flex items-center gap-3 w-full h-6 relative group" style={isDisabled() ? { opacity: 0.5 } : {}}>
                                <Show when={isDisabled()}>
                                    <div class="absolute top-1/2 left-0 right-0 h-[2px] bg-red-500 z-[60] pointer-events-none" />
                                </Show>
                                <div
                                    class="absolute w-6 h-6 rounded-full border border-white/50 shadow-sm cursor-pointer hover:scale-110 transition-transform z-[50]"
                                    style={{ "background-color": "#10b981", left: "-27px" }}
                                    data-port-type="input"
                                    data-port-name={input.name}
                                    data-panel-port="true"
                                    ref={(el) => registerPanelPort(el, input.name)}
                                    onMouseDown={(e) => { e.stopPropagation(); if (props.onLinkMove) props.onLinkMove(input.name, e); }}
                                    onMouseUp={(e) => { e.stopPropagation(); props.onLinkDrop(input.name); }}
                                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); toggleParamDisabled(input.name); }}
                                />
                                <span class="font-bold text-[11px] truncate relative z-10 drop-shadow-md cursor-context-menu"
                                    style={{ color: '#FFFFFF', "max-width": "120px" }}
                                    title={`${input.label || input.name} (Right-click to disable)`}
                                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); toggleParamDisabled(input.name); }}
                                >{input.label || input.name}</span>
                                <button
                                    class={`w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 transition-colors ${isPortVisible(input.name) ? "text-white/50" : "text-white/20"}`}
                                    onClick={(e) => { e.stopPropagation(); togglePortVisibility(input.name); }}
                                >
                                    <Show when={isPortVisible(input.name)} fallback={
                                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>
                                    }>
                                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                                    </Show>
                                </button>
                                {/* Inline Widget */}
                                <Show when={!isArt() && input.name === 'image'}>
                                    <div class="flex-1 flex justify-start min-w-0 ml-2">
                                         <label class={`flex items-center justify-start gap-1.5 h-5 rounded px-2 border transition-all cursor-pointer relative group ${(props.params.image_path) ? "bg-emerald-500/20 border-emerald-500/40 hover:bg-emerald-500/30" : "bg-white/10 border-white/20 text-white/90 hover:bg-white/20 hover:text-white"}`}
                                         onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); props.onParamChange("image_path", ""); props.onParamChange("image_filename", ""); }}>
                                             <input type="file" accept="image/*" class="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer z-50 block" onChange={(e) => {
                                                  const file = e.currentTarget.files?.[0];
                                                  if (file) {
                                                      const reader = new FileReader();
                                                      reader.onload = (evt) => { if (evt.target?.result) { props.onParamChange("image_path", evt.target.result); props.onParamChange("image_filename", file.name); }};
                                                      reader.readAsDataURL(file);
                                                  }
                                                  e.currentTarget.value = "";
                                             }}/>
                                             <div class="pointer-events-none flex items-center gap-1.5 relative z-0 min-w-0 flex-1 overflow-hidden">
                                                 <Show when={props.params.image_path && !isDisabled()} fallback={<span>Load</span>}>
                                                     <span>{props.params.image_filename || "Loaded"}</span>
                                                 </Show>
                                             </div>
                                         </label>
                                    </div>
                                </Show>
                            </div>
                        );
                    }}
                 </For>
                  <div class="h-px bg-white/5 my-1" />
             </div>
        </Show>

        {/* Outputs */}
        <Show when={getOutputs().length > 0}>
             <div class="flex-shrink-0 flex flex-col gap-2 p-4 pt-0 pb-2 relative">
                 <For each={getOutputs()}>
                     {(output) => {
                         const isDisabled = () => props.params[output.name] === DISABLED_PREFIX;
                         return (
                             <div class="flex items-center justify-end gap-3 w-full h-6 relative group" style={isDisabled() ? { opacity: 0.5 } : {}}>
                                 <Show when={isDisabled()}><div class="absolute top-1/2 left-0 right-0 h-[2px] bg-red-500 z-[60] pointer-events-none" /></Show>
                                 <div class="absolute w-6 h-6 rounded-full border border-white/50 shadow-sm cursor-cell hover:scale-110 transition-transform z-[50]"
                                     style={{ "background-color": "#10b981", right: "-27px" }}
                                     data-port-type="output"
                                     data-port-name={output.name}
                                     data-panel-port="true"
                                     ref={(el) => registerPanelPort(el, output.name)}
                                     onMouseDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); props.onLinkStart(output.name, e.clientX, e.clientY); }}
                                     onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); toggleParamDisabled(output.name); }}
                                  />
                                 <button class={`w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 transition-colors mr-1 ${isPortVisible(output.name) ? "text-white/50" : "text-white/20"}`}
                                     onClick={(e) => { e.stopPropagation(); togglePortVisibility(output.name); }}>
                                     <Show when={isPortVisible(output.name)} fallback={<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>}>
                                          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                                     </Show>
                                 </button>
                                 <span class="font-bold text-[11px] truncate text-right relative z-10 drop-shadow-md cursor-context-menu"
                                     style={{ color: '#FFFFFF', "max-width": "120px" }}
                                     onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); toggleParamDisabled(output.name); }}
                                 >{output.label || output.name}</span>
                             </div>
                         );
                     }}
                 </For>
                  <div class="h-px bg-white/5 my-1" />
             </div>
        </Show>

        {/* Params Scroll Container */}
        <div
            class="relative flex w-full flex-1 min-h-0"
            style={{
                "max-height": "min(360px, calc(100vh - 300px))",
            }}
        >
            <div
                 ref={(el) => {
                     scrollContainerRef = el;
                     const savedScrollTop = globalScrollRegistry[props.unit.id];
                     requestAnimationFrame(() => {
                         if (typeof savedScrollTop === "number") {
                             setManualScrollTop(savedScrollTop);
                         } else {
                             syncScrollMetrics();
                         }
                     });
                 }}
                 onScroll={(e) => {
                     globalScrollRegistry[props.unit.id] = e.currentTarget.scrollTop;
                     syncScrollMetrics();
                 }}
                 onWheel={(event) => {
                     event.preventDefault();
                     event.stopPropagation();
                     void api.focusOverlayWindow();
                     applyManualScrollDelta(event.deltaY);
                 }}
                 class="param-scroll-container bg-transparent w-full"
                 style={{
                     "flex": "1",
                     "min-height": "0",
                     "overflow-y": "auto",
                     "overflow-x": "hidden",
                     "max-height": "min(360px, calc(100vh - 300px))",
                     "padding-right": "12px",
                 }}
            >
                 <div class="flex flex-col gap-3 p-4 pt-0">
                      <Show
                          when={shouldGroupArtParams(derivedParams())}
                          fallback={<For each={derivedParams()}>{(param) => renderParamControl(param)}</For>}
                      >
                          <For each={paramGroups()}>
                              {(group) => (
                                  <div class="param-group flex flex-col gap-3" data-param-group={group.id}>
                                      <div
                                          class="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/65"
                                          data-param-group-header={group.id}
                                      >
                                          <span class="truncate">{group.label}</span>
                                          <span class="text-white/40">{group.params.length}</span>
                                      </div>
                                      <For each={group.params}>{(param) => renderParamControl(param)}</For>
                                  </div>
                              )}
                          </For>
                      </Show>
                 </div>
            </div>
            <div
                ref={scrollTrackRef}
                data-param-scrollbar-track
                class="param-scrollbar-track absolute bottom-3 right-1 top-3"
                style={{
                    width: "8px",
                    opacity: hasScrollableOverflow() ? 1 : 0.35,
                }}
                onMouseDown={handleScrollTrackMouseDown}
            >
                <div
                    data-param-scrollbar-thumb
                    class="param-scrollbar-thumb absolute left-0 right-0"
                    style={{
                        height: `${getScrollThumbHeight()}px`,
                        top: `${getScrollThumbTop()}px`,
                        opacity: hasScrollableOverflow() ? 1 : 0.45,
                        "pointer-events": hasScrollableOverflow() ? "auto" : "none",
                    }}
                    onMouseDown={startScrollThumbDrag}
                />
            </div>
        </div>
    </div>

    {/* Expanded Settings Panel (Sibling) */}
    <Show when={props.execConfig?.__expanded}>
        <div ref={settingsPanelRef}
            class="hook-terminal-shell hook-terminal-shell--strong absolute z-[101] pointer-events-auto animate-in fade-in slide-in-from-left-2 duration-200"
            style={{
                position: "absolute",
                left: "calc(50% + 125px + 8px)",
                top: "calc(100% + 12px)",
                width: "180px",
                "padding": "12px",
            }}
            onPointerDown={focusOverlayFromPointerEvent}
            onMouseDown={focusOverlayFromPointerEvent}
            onClick={(e) => e.stopPropagation()}
            onDblClick={(e) => e.stopPropagation()}
        >
             <div class="text-[10px] uppercase tracking-wider mb-2 pb-1.5" style={{ color: "var(--text-muted)", "border-bottom": "1px solid var(--glass-border)", "font-weight": "500" }}>执行设置</div>

             {/* Trigger Mode */}
             <div class="flex items-center justify-between gap-3 mb-2">
                 <label class="flex items-center gap-1.5 cursor-pointer select-none group">
                     <input type="checkbox" checked={props.execConfig?.triggerMode?.upstreamDriven ?? true} onChange={(e) => { e.stopPropagation(); props.onParamChange(EXEC_upstreamDriven, e.currentTarget.checked); }} class="w-3.5 h-3.5 rounded cursor-pointer" style={{ "accent-color": "var(--primary)" }} />
                     <span class="text-[11px] group-hover:opacity-100 transition-opacity" style={{ color: "var(--text-secondary)", opacity: "0.85" }}>上游驱动</span>
                 </label>
                 <label class="flex items-center gap-1.5 cursor-pointer select-none group">
                     <input type="checkbox" checked={props.execConfig?.triggerMode?.paramDriven ?? true} onChange={(e) => { e.stopPropagation(); props.onParamChange(EXEC_paramDriven, e.currentTarget.checked); }} class="w-3.5 h-3.5 rounded cursor-pointer" style={{ "accent-color": "var(--primary)" }} />
                     <span class="text-[11px] group-hover:opacity-100 transition-opacity" style={{ color: "var(--text-secondary)", opacity: "0.85" }}>参数驱动</span>
                 </label>
             </div>

             {/* Propagation */}
             <div class="flex items-center justify-between gap-3">
                 <label class="flex items-center gap-1.5 cursor-pointer select-none group">
                     <input type="checkbox" checked={props.execConfig?.propagation?.listenUpstream ?? true} onChange={(e) => { e.stopPropagation(); props.onParamChange(EXEC_listenUpstream, e.currentTarget.checked); }} class="w-3.5 h-3.5 rounded cursor-pointer" style={{ "accent-color": "var(--accent-blue)" }} />
                     <span class="text-[11px] group-hover:opacity-100 transition-opacity" style={{ color: "var(--text-secondary)", opacity: "0.85" }}>⬅ 监听上游</span>
                 </label>
                 <label class="flex items-center gap-1.5 cursor-pointer select-none group">
                     <input type="checkbox" checked={props.execConfig?.propagation?.notifyDownstream ?? true} onChange={(e) => { e.stopPropagation(); props.onParamChange(EXEC_notifyDownstream, e.currentTarget.checked); }} class="w-3.5 h-3.5 rounded cursor-pointer" style={{ "accent-color": "var(--accent-blue)" }} />
                     <span class="text-[11px] group-hover:opacity-100 transition-opacity" style={{ color: "var(--text-secondary)", opacity: "0.85" }}>通知下游 ➡</span>
                 </label>
             </div>

             <Show when={props.unit.type === 'sticker'}>
                  <div class="h-px w-full bg-white/10 my-2" />
                 <label class="flex items-center justify-between gap-2 cursor-pointer select-none group">
                     <span class="text-[11px] leading-4" style={{ color: "var(--text-secondary)", opacity: "0.9" }}>接受上级贴图编辑传导</span>
                     <input
                         type="checkbox"
                         checked={acceptsUpstreamStickerEditPropagation()}
                         onChange={(e) => {
                             e.stopPropagation();
                             setAcceptsUpstreamStickerEditPropagation(e.currentTarget.checked);
                         }}
                         class="w-3.5 h-3.5 rounded cursor-pointer"
                         style={{ "accent-color": "var(--accent-blue)" }}
                     />
                 </label>
                 <Show when={props.unit.data.stickerEditPropagation?.locallyEdited}>
                     <div class="mt-1 text-[10px] text-white/35">已本地编辑</div>
                 </Show>
             </Show>

              <div class="h-px w-full bg-white/10 my-2" />

             <button
                 class={`hook-terminal-btn w-full flex items-center justify-center gap-2 h-7 text-[11px] font-medium transition-all ${displaySrc() ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}
                 onMouseDown={(e) => e.stopPropagation()}
                 onClick={(e) => {
                     e.stopPropagation();
                     const src = displaySrc();
                     if (!src) return;
                     const img = new Image();
                     img.onload = () => {
                         const aspect = img.width / img.height;
                         const nodeAspect = props.unit.w / props.unit.h;
                         let newW = props.unit.w;
                         let newH = props.unit.h;
                         if (aspect > nodeAspect) newH = props.unit.w / aspect;
                         else newW = props.unit.h * aspect;
                         props.onParamChange(PARAM_ui_resize, { w: newW, h: newH });
                         setTimeout(() => setLayoutTick(t => t + 1), 50);
                     };
                     img.src = src;
                 }}
                 disabled={!displaySrc()}
                 title={displaySrc() ? "适配图片比例" : "暂无图片内容"}
             >
                 <svg class={`w-3.5 h-3.5 ${displaySrc() ? "opacity-70" : "opacity-30"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M16 20h2a2 2 0 012-2v-2M4 16v2a2 2 0 002 2h2M9 10h6v4H9z" /></svg>
                 合拢外框
             </button>
        </div>
    </Show>

    <Show when={editingTextId()}>
             <div
                 class="hook-terminal-shell hook-terminal-shell--strong absolute flex flex-col z-[110] animate-in slide-in-from-left-2 duration-200 pointer-events-auto"
                 style={{
                     position: "absolute",
                     left: "calc(100% + 274px)",
                     top: "0",
                     width: "200px",
                     "padding": "12px",
                     "color": "var(--text-primary)"
                 }}
                 onPointerDown={focusOverlayFromPointerEvent}
                 onMouseDown={focusOverlayFromPointerEvent}
                 onClick={(e) => e.stopPropagation()}
                 onDblClick={(e) => e.stopPropagation()}
             >
                 <div class="flex items-center justify-between mb-2">
                     <span class="text-xs font-bold text-white/90 uppercase tracking-wider">Edit Text</span>
                      <button class="text-white/40 hover:text-white transition-colors" onClick={() => setEditingTextId(null)}><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
                 </div>
                 <textarea class="hook-terminal-input w-full h-[150px] p-3 text-[11px] leading-relaxed resize-y min-h-[100px] scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent font-mono mb-3"
                     value={tempText()}
                     onInput={(e) => setTempText(e.currentTarget.value)}
                     onPointerDown={focusOverlayFromPointerEvent}
                     onMouseDown={focusOverlayFromPointerEvent}
                     onClick={(e) => e.stopPropagation()}
                     placeholder="Enter text..."
                     autofocus
                 />
                 <div class="flex justify-between items-center mt-auto">
                     <span class="text-[10px] text-white/30 font-mono self-center">{tempText().length} chars</span>
                     <button class="hook-terminal-btn hook-terminal-btn--success px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95"
                         onClick={(e) => { e.stopPropagation(); props.onParamChange(editingTextId()!, tempText()); setEditingTextId(null); }}>Save Text</button>
                 </div>
             </div>
    </Show>

    <Show when={hoveringDataUrlPreview()}>
        {(previewSrc) => (
            <div class="hook-terminal-shell hook-terminal-shell--strong absolute flex flex-col z-[110] animate-in slide-in-from-left-2 duration-200 pointer-events-auto"
                style={{
                    position: "absolute",
                    left: "calc(100% + 274px)",
                    top: "0", width: "250px",
                    "padding": "8px", "color": "var(--text-primary)"
                }} onMouseDown={(e) => e.stopPropagation()}
            >
                 <div class="mb-2 flex justify-between items-center text-[10px] text-white/50 font-mono border-b border-white/10 pb-1"><span class="font-bold text-white/80 uppercase tracking-widest">Image Preview</span></div>
                 <img src={previewSrc()} class="w-full h-auto object-contain bg-black/20 border border-white/5" style={{"max-height": "300px"}} />
                 <div class="mt-1 text-[9px] text-white/30 font-mono text-right truncate">{(previewSrc().length / 1024).toFixed(1)} KB</div>
            </div>
        )}
    </Show>
    </>
  );
};
