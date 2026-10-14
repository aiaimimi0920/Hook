
import { Component, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Unit, Link, NodeExecutionConfig } from "../types/unit";
import { ArtCapability, ArtParam } from "../services/protocol";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { UnitPropertyCapsule } from "./UnitPropertyCapsule";
import { paramPropertyType } from "./UnitPropertyTypeIcon";
import { UnitNodeSettingsStrip } from "./UnitNodeSettingsStrip";
import { hideCollapsedUnitEndpoints } from "../store/unitChromeState";
import { observeUnitTabGeometry } from "./unitTabGeometry";
import "../styles/unit-tab-properties.css";
import { UnitLivePublication } from "./UnitLivePublication";
import { UnitLiveViewer } from "./UnitLiveViewer";
import { supportsSurface } from "../services/artCapabilities";
import { UnitParamControl } from "./params/UnitParamControl";
import { UnitParamsCandidateResults } from "./UnitParamsCandidateResults";
import {
    UnitParamsPortRows,
} from "./UnitParamsPortRows";
import { UnitParamsScrollRegion } from "./UnitParamsScrollRegion";
import { createUnitParamsPortRegistryController } from "./unitParamsPortRegistryController";
import { graphStore } from "../store/graphStore";
import { resolveEffectiveNodeParams } from "../services/graphImageResolution";
import { api } from "../services/api";
import {
    formatArtParamTextValue,
    parseArtParamTextValue,
} from "../services/artParamTextValue";
import {
    DISABLED_PREFIX,
} from "../constants";

interface UnitParamsPanelProps {
  outlineOutset?: number;
  expanded?: boolean;
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
      <UnitPropertyCapsule unitId={props.unit.id} name={param.id} label={param.label} type={paramPropertyType(param)} side="input"
          expanded={props.expanded !== false} linked={isParamLinked(param.id)} disabled={props.params[param.id] === DISABLED_PREFIX}
          register={registerPanelPort} onLinkMove={props.onLinkMove} onLinkDrop={props.onLinkDrop} onToggleDisable={toggleParamDisabled}>
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
          onEditStart={() => openTextEditor(param)}
          onPreview={(id, active) => setHoveringParam(active ? id : null)}
      />
      </UnitPropertyCapsule>
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

  // Geometry follows individual controls and scrolling instead of a fixed panel box.
  createEffect(() => {
       void props.unit.x; void props.unit.y; void props.unit.w; void props.unit.h;
       void props.outlineOutset;
       if (!paramContainerRef) return;
       const geometry = observeUnitTabGeometry(paramContainerRef, () => props.unit);
       onCleanup(geometry.dispose);
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
        ref={(el) => { paramContainerRef = el; }}
        id={`params-panel-${props.unit.id}`}
        class="unit-tab-properties"
        style={{ "--unit-outline-outset": `${props.outlineOutset ?? 0}px` }}
        classList={{ "is-expanded": props.expanded !== false, "hide-collapsed-endpoints": hideCollapsedUnitEndpoints(props.unit.data.hideCollapsedEndpoints) }}
        onPointerDown={focusOverlayFromPointerEvent}
        onMouseDown={focusOverlayFromPointerEvent}
        onMouseUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
    >
        <div class="unit-tab-rail unit-tab-rail--input">
        <UnitParamsPortRows
            side="input" expanded={props.expanded !== false}
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

        <UnitParamsScrollRegion
            unit={props.unit}
            params={derivedParams()}
            renderParamControl={renderParamControl}
        />
        </div>
        <div class="unit-tab-rail unit-tab-rail--output">
            <UnitParamsPortRows side="output" expanded={props.expanded !== false} unit={props.unit} params={props.params}
                capability={props.capability} onParamChange={props.onParamChange} onLinkStart={props.onLinkStart}
                onLinkDrop={props.onLinkDrop} onLinkMove={props.onLinkMove} registerPanelPort={registerPanelPort}
                toggleParamDisabled={toggleParamDisabled} />
        <Show when={props.expanded !== false}><div class="unit-tab-aux" data-tab-hit-region>
            <Show when={isArt()}><UnitParamsCandidateResults unit={props.unit} params={props.params} onParamChange={props.onParamChange} /></Show>
            <UnitLivePublication unitId={props.unit.id} />
            <Show when={isArt() && supportsSurface(props.capability)}><UnitLiveViewer unitId={props.unit.id} /></Show>
        </div></Show>
        </div>
        <UnitNodeSettingsStrip unit={props.unit} capability={props.capability} execConfig={props.execConfig}
            expanded={props.expanded !== false} onParamChange={props.onParamChange} />
    </div>

    <Show when={editingTextId()}>
             <div
                 class="otter-terminal-shell otter-terminal-shell--strong absolute flex flex-col z-[110] animate-in slide-in-from-left-2 duration-200 pointer-events-auto"
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
                      <button class="otter-toolbar-button" onClick={closeTextEditor}><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
                 </div>
                 <textarea class="otter-terminal-input otter-scrollbar w-full h-[150px] p-3 text-[11px] leading-relaxed resize-y min-h-[100px] font-mono mb-3"
                     value={tempText()}
                     onInput={(e) => { setTempText(e.currentTarget.value); setTextEditorError(null); }}
                     onPointerDown={focusOverlayFromPointerEvent}
                     onMouseDown={focusOverlayFromPointerEvent}
                     onClick={(e) => e.stopPropagation()}
                     placeholder="Enter text..."
                     autofocus
                 />
                 <Show when={textEditorError()}>
                     {(message) => <div class="otter-inline-danger mb-2 text-[10px] leading-4">JSON 格式错误：{message()}</div>}
                 </Show>
                 <div class="flex justify-between items-center mt-auto">
                     <span class="otter-inline-muted text-[10px] font-mono self-center">{tempText().length} chars</span>
                     <button class="otter-terminal-btn otter-terminal-btn--success px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95"
                         onClick={(e) => { e.stopPropagation(); commitTextEditor(); }}>Save Text</button>
                 </div>
             </div>
    </Show>

    <Show when={hoveringDataUrlPreview()}>
        {(previewSrc) => (
            <div class="otter-terminal-shell otter-terminal-shell--strong absolute flex flex-col z-[110] animate-in slide-in-from-left-2 duration-200 pointer-events-auto"
                style={{
                    position: "absolute",
                    left: "calc(100% + 274px)",
                    top: "0", width: "250px",
                    "padding": "8px", "color": "var(--text-primary)"
                }} onMouseDown={(e) => e.stopPropagation()}
            >
                 <div class="otter-preview-header mb-2 flex justify-between items-center text-[10px] font-mono pb-1"><span class="font-bold uppercase tracking-widest">Image Preview</span></div>
                 <img src={previewSrc()} class="otter-image-preview-frame w-full h-auto object-contain" style={{"max-height": "300px"}} />
                 <div class="otter-inline-muted mt-1 text-[9px] font-mono text-right truncate">{(previewSrc().length / 1024).toFixed(1)} KB</div>
            </div>
        )}
    </Show>
    </>
  );
};
