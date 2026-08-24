import { Accessor, createEffect, onCleanup } from "solid-js";
import { addOrUpdateRect, removeRect, updatePortOffset } from "../services/uiRegistry";
import type { Unit } from "../types/unit";

interface NamedPort {
    name: string;
}

interface UnitPortRegistryControllerOptions {
    unit: Accessor<Unit>;
    inputs: Accessor<NamedPort[]>;
    outputs: Accessor<NamedPort[]>;
    element: Accessor<HTMLDivElement | undefined>;
}

/** Keeps floating-panel anchors and native hit-test port strips synchronized. */
export const createUnitPortRegistryController = (options: UnitPortRegistryControllerOptions) => {
    createEffect(() => {
        if (typeof window === "undefined") return;
        const unitElement = options.element();
        if (!unitElement) return;
        const unitId = options.unit().id;
        const animationFrames = new Set<number>();
        const timers = new Set<number>();
        const scheduleFrame = (callback: () => void) => {
            const id = window.requestAnimationFrame(() => {
                animationFrames.delete(id);
                callback();
            });
            animationFrames.add(id);
        };
        const scheduleTimer = (callback: () => void, delay: number) => {
            const id = window.setTimeout(() => {
                timers.delete(id);
                callback();
            }, delay);
            timers.add(id);
        };
        const registerPanelPort = (element: HTMLElement, portName: string) => {
            const update = () => {
                if (
                    !unitElement.isConnected ||
                    !element.isConnected ||
                    options.element() !== unitElement ||
                    options.unit().id !== unitId ||
                    element.closest(".unit-container") !== unitElement
                ) return;
                const portRect = element.getBoundingClientRect();
                const unitRect = unitElement.getBoundingClientRect();
                const x = portRect.left + portRect.width / 2 - unitRect.left;
                const y = portRect.top + portRect.height / 2 - unitRect.top;
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                updatePortOffset(unitId, portName, { x, y });
            };
            update();
            scheduleFrame(update);
            scheduleTimer(update, 50);
        };

        scheduleFrame(() => {
            if (options.element() !== unitElement || options.unit().id !== unitId) return;
            unitElement.querySelectorAll('[data-panel-port="true"]').forEach((element) => {
                const portName = element.getAttribute("data-port-name");
                if (portName) registerPanelPort(element as HTMLElement, portName);
            });
        });
        onCleanup(() => {
            animationFrames.forEach((id) => window.cancelAnimationFrame(id));
            timers.forEach((id) => window.clearTimeout(id));
            animationFrames.clear();
            timers.clear();
        });
    });

    createEffect(() => {
        const unit = options.unit();
        const inputs = options.inputs();
        const outputs = options.outputs();
        inputs.forEach((port, index) => {
            addOrUpdateRect({
                id: `port-in-${unit.id}-${index}`,
                x: unit.x - 18,
                y: unit.y + 24 + index * 36,
                width: 18,
                height: 24,
                name: `PORT_IN_${port.name}`,
            });
        });
        outputs.forEach((port, index) => {
            addOrUpdateRect({
                id: `port-out-${unit.id}-${index}`,
                x: unit.x + unit.w,
                y: unit.y + 24 + index * 36,
                width: 18,
                height: 24,
                name: `PORT_OUT_${port.name}`,
            });
        });
        onCleanup(() => {
            inputs.forEach((_, index) => removeRect(`port-in-${unit.id}-${index}`));
            outputs.forEach((_, index) => removeRect(`port-out-${unit.id}-${index}`));
        });
    });
};
