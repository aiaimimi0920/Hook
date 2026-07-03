
import { Component, For, Show, createEffect, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { Unit } from "../types/unit";
import { ArtCapability } from "../services/protocol";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";

interface UnitAddNodeMenuProps {
  unit?: Unit;
  availableArts?: ArtCapability[];
  onAddNode: (artId: string) => void;
  showActions: boolean;
  currentPos: { x: number; y: number };
}

export const UnitAddNodeMenu: Component<UnitAddNodeMenuProps> = (props) => {

    // Register Rect for Hit Testing
    createEffect(() => {
        if (props.showActions && !props.unit?.data.minified) {
            const u = props.unit;
            // Center of unit
            const cx = u ? u.x + u.w / 2 : props.currentPos.x;
            const cy = u ? u.y + u.h / 2 : props.currentPos.y;

            addOrUpdateRect({
                  id: `actions-menu-${u?.id ?? "global"}`,
                  x: cx - 125, // Width 250 / 2
                  y: cy - 150, // Height 300 / 2
                  width: 250,
                  height: 300,
                  name: "ACTIONS_MENU"
            });
            onCleanup(() => removeRect(`actions-menu-${u?.id ?? "global"}`));
        } else {
             removeRect(`actions-menu-${props.unit?.id ?? "global"}`);
        }
    });

    return (
        <Show when={props.showActions && !props.unit?.data.minified}>
            <Portal mount={document.body}>
                <div
                    id={`actions-menu-${props.unit?.id ?? "global"}`}
                    class="hook-terminal-shell hook-terminal-shell--strong absolute flex flex-col pointer-events-auto overflow-hidden transition-all duration-200 ease-out animate-in fade-in zoom-in-95 text-white"
                    onMouseDown={(e) => e.stopPropagation()}
                    onDblClick={(e) => e.stopPropagation()}
                    style={{
                        "z-index": 999999,
                        left: `${props.unit ? props.currentPos.x + props.unit.w / 2 : props.currentPos.x}px`,
                        top: `${props.unit ? props.currentPos.y + props.unit.h / 2 : props.currentPos.y}px`,
                        "margin-left": "-125px",
                        "margin-top": "-150px",
                        width: "250px",
                        height: "300px",
                }}
            >
                {/* Header */}
                <div
                    class="hook-actions-shell h-[50px] min-h-[50px] border-b border-white/10 px-4 z-10 relative"
                    style={{
                        "display": "flex",
                        "justify-content": "center",
                        "align-items": "center",
                        "width": "100%"
                    }}
                >
                    <div class="hook-actions-shell__title">
                        <span class="hook-actions-shell__dot"></span>
                        <span class="font-bold text-xs uppercase tracking-widest whitespace-nowrap">Add Art Node</span>
                    </div>
                </div>

                {/* Body */}
                <div class="flex-1 overflow-y-auto bg-transparent p-3 flex flex-col gap-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                     <Show when={props.availableArts && props.availableArts.length > 0} fallback={
                        <div class="text-white/30 text-xs font-medium text-center py-8">
                            No available arts
                        </div>
                     }>
                        <For each={props.availableArts}>
                            {(art) => (
                                <button
                                    class="hook-terminal-list-item group relative overflow-hidden flex items-center w-full px-3 py-3 text-sm transition-all cursor-pointer active:scale-[0.98] text-white"
                                    style={{ color: "white" }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        props.onAddNode(art.id);
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <div class="hook-terminal-icon-tile flex h-8 w-8 items-center justify-center mr-3 transition-colors">
                                        <span class="text-base">❖</span>
                                    </div>
                                    <div class="flex flex-col items-start z-10 min-w-0 flex-1">
                                        <span class="font-medium text-gray-100 group-hover:text-white truncate w-full text-left">{art.label}</span>
                                        <span class="text-[10px] text-gray-400 group-hover:text-gray-200 truncate w-full text-left">{art.description || "No description"}</span>
                                    </div>
                                </button>
                            )}
                        </For>
                     </Show>
                </div>
            </div>
            </Portal>
        </Show>
    );
};
