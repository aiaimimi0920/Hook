import { Component, For, onCleanup } from "solid-js";
import { UnitView } from "./UnitView";
import { graphStore } from "../store/graphStore";
import {
    selectedStickerId,
    selectedUnitIds,
    unitUiState,
    multiDragPositions,
    activeStickerGroupId,
    uiActions,
} from "../store/uiStore";
import { syncService } from "../services/syncService";

// Define Props for callbacks that are still managed by parent or complex flows
interface CanvasUnitsProps {
    onStartDrag: (e: MouseEvent, id: string) => void;
    onDoubleClick: (e: MouseEvent, id: string) => void;
    onDelete: (id: string) => void;
    onAddNode: (fromId: string, artId: string) => void;
    onParamChange: (id: string, pid: string, val: any, isFinal?: boolean) => void;

    // Linking events
    onLinkStart: (uId: string, portId: string, x: number, y: number) => void;
    onLinkDrop: (uId: string, portId: string) => void;
    onLinkMove: (uId: string, portId: string, e: MouseEvent) => void;
    onLinkHover: (uId: string, targetId: string | null) => void;
    onRendered: (id: string, dataUrl: string) => void;

    resolveUnitImage: (id: string) => string | undefined;
    portsLayerRef: HTMLDivElement | undefined;
}

export const CanvasUnits: Component<CanvasUnitsProps> = (props) => {
    const STICKER_RESIZE_SYNC_DEBOUNCE_MS = 140;
    let stickerResizeSyncTimer: ReturnType<typeof window.setTimeout> | null = null;

    const scheduleStickerResizeSync = () => {
        if (stickerResizeSyncTimer !== null) {
            window.clearTimeout(stickerResizeSyncTimer);
        }

        stickerResizeSyncTimer = window.setTimeout(() => {
            stickerResizeSyncTimer = null;
            void syncService.performWorkflowSync();
        }, STICKER_RESIZE_SYNC_DEBOUNCE_MS);
    };

    onCleanup(() => {
        if (stickerResizeSyncTimer !== null) {
            window.clearTimeout(stickerResizeSyncTimer);
            stickerResizeSyncTimer = null;
        }
    });

    return (
      <For each={graphStore.units.filter((unit) => {
          const activeGroup = activeStickerGroupId();
          if (activeGroup && unit.data.groupId !== activeGroup) {
              return false;
          }
          const group = unit.data.groupId
              ? graphStore.stickerGroups.find((item) => item.id === unit.data.groupId)
              : undefined;
          return !group?.hidden;
      })}>{(u) => {
          return (
          <UnitView
              // State
              unit={u}
              multiDragPositions={multiDragPositions()}
              params={graphStore.unitParams[u.id] || {}}
              execConfig={graphStore.unitExecConfig[u.id]}
              isSelected={selectedUnitIds.includes(u.id) || selectedStickerId() === u.id}

              // UI State (Show/Hide panels)
              showActions={(unitUiState[u.id]?.showActions || false) && !u.data.minified}
              showParams={(unitUiState[u.id]?.showParams || false) && !u.data.minified}

              // Capabilities
              capability={u.type === 'art' ? graphStore.capabilities.find(c => c.id === u.artId) : undefined}
              availableArts={graphStore.capabilities}

              // Setup
              portsLayer={props.portsLayerRef}

              // Events
              onMouseDown={(e) => props.onStartDrag(e, u.id)}
              onDoubleTap={(e) => props.onDoubleClick(e, u.id)}

              onDelete={() => props.onDelete(u.id)}
              onAddNode={(artId) => {
                  props.onAddNode(u.id, artId);
                  uiActions.closeActions(u.id);
              }}
              onParamChange={(pid, val, isFinal) => props.onParamChange(u.id, pid, val, isFinal)}

              // Linking
              onLinkStart={(propId, x, y) => props.onLinkStart(u.id, propId, x, y)}
              onLinkDrop={(portId) => props.onLinkDrop(u.id, portId)}
              onLinkMove={(portId, e) => props.onLinkMove(u.id, portId, e)}
              onLinkHover={(targetId) => props.onLinkHover(u.id, targetId)}
              onRendered={props.onRendered}

              // Resizing
              onResize={(nextFrame) => {
                  graphStore.actions.resizeStickerFrame(u.id, nextFrame);
                  scheduleStickerResizeSync();
              }}
              onOpacityChange={(val) => {
                  if (u.data.minified) {
                      graphStore.actions.updateUnitData(u.id, { opacityMini: val });
                  } else {
                      graphStore.actions.updateUnitData(u.id, { opacityNormal: val });
                  }
                  // Persist immediately (debouncing could be added if scroll is too frequent)
                  syncService.performWorkflowSync();
              }}

              // Data Resolution
              connectedPorts={graphStore.links.filter(l => l.toUnitId === u.id).map(l => l.toPortId)}
              connectedLinks={graphStore.links.filter(l => l.toUnitId === u.id)}
              resolveUnitImage={props.resolveUnitImage}
          />
          );
      }}</For>
    );
};
