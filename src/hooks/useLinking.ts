import { graphStore } from "../store/graphStore";
import { linkingState, setLinkingState, setMousePos, setIsSelecting, setHoveringLink, selectedUnitIds, unitUiState, multiDragPositions, isCleanView } from "../store/uiStore";
import { syncService } from "../services/syncService";
import { calculatePortY } from "../utils/graphUtils";
import { showUnitFailureNotice } from "../services/unitFailureNotice";
import { portOffsets } from "../services/uiRegistry";
import { unitOutlineOutset } from "../components/UnitSelectionBorder";

interface UseLinkingOptions {
    onLinkCreated?: (sourceUnitId: string, targetUnitId: string, targetPortId: string) => void;
}

export function useLinking(options: UseLinkingOptions = {}) {

    const startLinking = (unitId: string, paramId: string, x: number, y: number) => {
        setLinkingState({
            isLinking: true,
            sourceUnitId: unitId,
            sourceParamId: paramId,
            startX: x,
            startY: y
        });
        setIsSelecting(false);
    };

    const handleLinkHover = (sourceId: string, targetId: string | null) => {
        setHoveringLink({ sourceUnitId: sourceId, targetUnitId: targetId });
    };

    const handleInputLinkDrag = (unitId: string, portId: string, e: MouseEvent) => {
        // 1. Check if occupied
        const index = graphStore.links.findIndex(l => l.toUnitId === unitId && l.toPortId === portId);
        if (index !== -1) {
            const link = graphStore.links[index];
            const sourceUnit = graphStore.units.find(u => u.id === link.fromUnitId);

            if (sourceUnit) {
                console.log("Re-linking (Moving) from input:", portId, "Source:", sourceUnit.id);

                const position = multiDragPositions()?.[sourceUnit.id] ?? sourceUnit;
                const selected = selectedUnitIds.includes(sourceUnit.id);
                const offset = !sourceUnit.data.minified && (selected || unitUiState[sourceUnit.id]?.showParams)
                    ? portOffsets()[sourceUnit.id]?.[link.fromPortId] : undefined;
                const outset = sourceUnit.data.minified ? 4 : isCleanView() ? 0 : unitOutlineOutset(selected);
                const startX = position.x + (offset?.x ?? sourceUnit.w + outset);
                const startY = offset ? position.y + offset.y
                    : calculatePortY(sourceUnit, link.fromPortId, false, graphStore.capabilities, position.y);

                // 2. Remove existing link using Action
                graphStore.actions.removeLink(link.id);

                // 3. Start Linking State
                setLinkingState({
                    isLinking: true,
                    sourceUnitId: link.fromUnitId,
                    sourceParamId: link.fromPortId,
                    startX: startX,
                    startY: startY
                });

                setMousePos({ x: e.clientX, y: e.clientY });
            }
        }
    };

    const handleLinkDrop = (targetUnitId: string, targetPortId: string) => {
        const state = linkingState();
        if (state.isLinking && state.sourceUnitId && state.sourceParamId && state.sourceUnitId !== targetUnitId) {
             const sourceId = state.sourceUnitId;

             // Cycle Detection
             const hasCycle = (start: string, end: string) => {
                 const visited = new Set<string>();
                 const queue = [start];
                 visited.add(start);

                 while (queue.length > 0) {
                     const curr = queue.shift()!;
                     if (curr === end) return true;

                     const neighbors = graphStore.links
                         .filter(l => l.fromUnitId === curr)
                         .map(l => l.toUnitId);

                     for (const n of neighbors) {
                         if (!visited.has(n)) {
                             visited.add(n);
                             queue.push(n);
                         }
                     }
                 }
                 return false;
             };

             if (hasCycle(targetUnitId, sourceId)) {
                 showUnitFailureNotice({ feature: "Interaction", title: "无法创建连接",
                     message: "此连接会形成循环依赖，请选择其他节点。",
                     source: { namespace: "core", id: "link-cycle" } }, targetUnitId);
                 setLinkingState({ isLinking: false, sourceUnitId: null, sourceParamId: null, startX: 0, startY: 0 });
                 return;
             }

             // Create Link
             const newLink = {
                 id: crypto.randomUUID(),
                 fromUnitId: sourceId,
                 fromPortId: state.sourceParamId,
                 toUnitId: targetUnitId,
                 toPortId: targetPortId
             };

             // Remove existing link to this specific input port (Single Input Rule)
             const existing = graphStore.links.find(l => l.toUnitId === targetUnitId && l.toPortId === targetPortId);
             if (existing) {
                 graphStore.actions.removeLink(existing.id);
             }

             graphStore.actions.addLink(newLink);
             options.onLinkCreated?.(sourceId, targetUnitId, targetPortId);
             syncService.performWorkflowSync();
        }
        setLinkingState({ isLinking: false, sourceUnitId: null, sourceParamId: null, startX: 0, startY: 0 });
    };

    return { startLinking, handleLinkHover, handleInputLinkDrag, handleLinkDrop };
}
