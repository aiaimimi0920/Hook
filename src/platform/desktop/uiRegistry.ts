import { createSignal } from "solid-js";

export interface PinRect {
    id: string; // Unique ID (e.g. "params-unit-1")
    x: number;
    y: number;
    width: number;
    height: number;
    name: string; // Debug/Log name
}

// Global signal to track active overlay rects (Logic Pixels)
const [extraRects, setExtraRects] = createSignal<PinRect[]>([]);

const isSameRect = (left: PinRect, right: PinRect) =>
    left.id === right.id &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.name === right.name;

export const addOrUpdateRect = (rect: PinRect) => {
    setExtraRects(prev => {
        const idx = prev.findIndex(r => r.id === rect.id);
        if (idx >= 0) {
            if (isSameRect(prev[idx], rect)) {
                return prev;
            }
            // Update existing
            const copy = [...prev];
            copy[idx] = rect;
            return copy;
        }
        // Add new
        return [...prev, rect];
    });
};

export const removeRect = (id: string) => {
    setExtraRects(prev => {
        if (!prev.some(r => r.id === id)) {
            return prev;
        }
        return prev.filter(r => r.id !== id);
    });
};

// PORT OFFSETS REGISTRY (UnitID -> PortName -> {x, y} relative to Unit)
// This avoids DOM thrashing/lag during drag by caching the relative position.
const [portOffsets, setPortOffsets] = createSignal<Record<string, Record<string, {x: number, y: number}>>>({});

export const updatePortOffset = (unitId: string, portName: string, offset: {x: number, y: number}) => {
    setPortOffsets(prev => {
        const unitMap = prev[unitId] || {};
        // Optimization: Don't update if same (avoid signal thrashing)
        if (unitMap[portName] && Math.abs(unitMap[portName].x - offset.x) < 0.1 && Math.abs(unitMap[portName].y - offset.y) < 0.1) {
            return prev;
        }
        return {
            ...prev,
            [unitId]: {
                ...unitMap,
                [portName]: offset
            }
        };
    });
};

export { portOffsets };

export { extraRects };
