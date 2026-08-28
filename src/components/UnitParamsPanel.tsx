
import { Component, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Unit, Link, NodeExecutionConfig } from "../types/unit";
import { ArtCapability, ArtParam } from "../services/protocol";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { UnitActionsMenu } from "./UnitActionsMenu";
import { UnitParamControl } from "./params/UnitParamControl";
import { UnitParamsCandidateResults } from "./UnitParamsCandidateResults";
import {
    getUnitParamsPanelInputs,
    UnitParamsPortRows,
} from "./UnitParamsPortRows";
import { UnitParamsScrollRegion } from "./UnitParamsScrollRegion";
import { UnitParamsExpandedSettings } from "./UnitParamsExpandedSettings";
import { UnitBarcodeResultPanel } from "./UnitBarcodeResultPanel";
import { createUnitParamsPortRegistryController } from "./unitParamsPortRegistryController";
import { graphStore } from "../store/graphStore";
import { normalizeImageSourceForDisplay } from "../services/imageSource";
import { resolveEffectiveNodeParams } from "../services/graphImageResolution";
import { api } from "../services/api";
import {
    formatArtParamTextValue,
    parseArtParamTextValue,
} from "../services/artParamTextValue";
import {
    DISABLED_PREFIX,
    EXEC_expanded,
    EXEC_manualTrigger,
} from "../constants";

interface UnitParamsPanelProps {
  unit: Unit;
  params: Record<string, any>; // Reactive
  execConfig?: NodeExecutionConfig;
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

export const UnitParamsPanel: Component<UnitParamsPanelProps> = (props) => {
  let paramContainerRef: HTMLDivElement | undefined;
  const portRegistry = createUnitParamsPortRegistryController(() => props.unit.id);

  const [editingTextId, setEditingTextId] = createSignal<string | null>(null);
  const [tempText, setTempText] = createSignal<string>("");
  const [textEditorError, setTextEditorError] = createSignal<string | null>(null);
  const [hoveringParam, setHoveringParam] = createSignal<string | null>(null);
  const [draggingSlider, setDraggingSlider] = createSignal<{ id: string; value: number } | null>(null);

  const isArt = () => props.unit.type === 'art';
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

  const getInputs = () => getUnitParamsPanelInputs(props.unit, props.capability);
  const derivedParams = () => {
      if (isArt()) return props.capability?.params?.filter((param) => !param.secret) || [];
      return [];
  };
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
      setTempText(formatArtParamTextValue(param, getParamValue(param.id, param.default)));
      setTextEditorError(null);
      setEditingTextId(param.id);
  };

  const closeTextEditor = () => {
      setEditingTextId(null);
      setTextEditorError(null);
  };

  const commitTextEditor = () => {
      const id = editingTextId();
      if (!id) return;
      const param = derivedParams().find((item) => item.id === id);
      if (!param) {
          closeTextEditor();
          return;
      }

      const parsed = parseArtParamTextValue(param, tempText());
      if (!parsed.ok) {
          setTextEditorError(parsed.error);
          return;
      }

      props.onParamChange(id, parsed.value, true);
      closeTextEditor();
  };

  const focusOverlayFromPointerEvent = (event: PointerEvent | MouseEvent) => {
      event.stopPropagation();
      void api.focusOverlayWindow();
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

  const registerPanelPort = portRegistry.register;
  onCleanup(portRegistry.dispose);

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
      if (!param) return;
      setTempText(formatArtParamTextValue(param, getParamValue(id, param.default)));
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
           });
           observer.observe(paramContainerRef);
       }
       onCleanup(() => {
           observer?.disconnect();
           removeRect(`params-${u.id}`);
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
      onCleanup(() => removeRect(`editor-${u.id}`));
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

        <Show when={isArt()}>
            <UnitParamsCandidateResults
                unit={props.unit}
                params={props.params}
                onParamChange={props.onParamChange}
            />
        </Show>

        <UnitParamsPortRows
            unit={props.unit}
            params={props.params}
            capability={props.capability}
            onParamChange={props.onParamChange}
            onLinkStart={props.onLinkStart}
            onLinkDrop={props.onLinkDrop}
            onLinkMove={props.onLinkMove}
            registerPanelPort={registerPanelPort}
            toggleParamDisabled={toggleParamDisabled}
        />

        <UnitBarcodeResultPanel unit={props.unit} />

        <UnitParamsScrollRegion
            unit={props.unit}
            params={derivedParams()}
            renderParamControl={renderParamControl}
        />
    </div>

    <UnitParamsExpandedSettings
        unit={props.unit}
        expanded={props.execConfig?.__expanded ?? false}
        execConfig={props.execConfig}
        displaySrc={displaySrc()}
        onParamChange={props.onParamChange}
    />

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
                     <span class="text-xs font-bold uppercase tracking-wider">Edit Text</span>
                      <button class="hook-toolbar-button" onClick={closeTextEditor}><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
                 </div>
                 <textarea class="hook-terminal-input hook-scrollbar w-full h-[150px] p-3 text-[11px] leading-relaxed resize-y min-h-[100px] font-mono mb-3"
                     value={tempText()}
                     onInput={(e) => { setTempText(e.currentTarget.value); setTextEditorError(null); }}
                     onPointerDown={focusOverlayFromPointerEvent}
                     onMouseDown={focusOverlayFromPointerEvent}
                     onClick={(e) => e.stopPropagation()}
                     placeholder="Enter text..."
                     autofocus
                 />
                 <Show when={textEditorError()}>
                     {(message) => <div class="hook-inline-danger mb-2 text-[10px] leading-4">JSON 格式错误：{message()}</div>}
                 </Show>
                 <div class="flex justify-between items-center mt-auto">
                     <span class="hook-inline-muted text-[10px] font-mono self-center">{tempText().length} chars</span>
                     <button class="hook-terminal-btn hook-terminal-btn--success px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95"
                         onClick={(e) => { e.stopPropagation(); commitTextEditor(); }}>Save Text</button>
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
                 <div class="hook-preview-header mb-2 flex justify-between items-center text-[10px] font-mono pb-1"><span class="font-bold uppercase tracking-widest">Image Preview</span></div>
                 <img src={previewSrc()} class="hook-image-preview-frame w-full h-auto object-contain" style={{"max-height": "300px"}} />
                 <div class="hook-inline-muted mt-1 text-[9px] font-mono text-right truncate">{(previewSrc().length / 1024).toFixed(1)} KB</div>
            </div>
        )}
    </Show>
    </>
  );
};
