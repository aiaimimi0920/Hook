import { updatePortOffset } from "../services/uiRegistry";

interface PendingPortRegistration {
    element: HTMLElement;
    rafId?: number;
    timerId?: number;
}

/** Keeps deferred panel-port measurements scoped to the latest live element. */
export const createUnitParamsPortRegistryController = (getUnitId: () => string) => {
    let disposed = false;
    const pendingRegistrations = new Map<string, PendingPortRegistration>();

    const cancelRegistration = (registration: PendingPortRegistration) => {
        if (registration.rafId !== undefined) cancelAnimationFrame(registration.rafId);
        if (registration.timerId !== undefined) window.clearTimeout(registration.timerId);
    };

    const register = (element: HTMLElement, portName: string) => {
        if (disposed) return;
        const previous = pendingRegistrations.get(portName);
        if (previous) cancelRegistration(previous);
        const registration: PendingPortRegistration = {
            element,
        };
        pendingRegistrations.set(portName, registration);
        const unitId = getUnitId();
        const update = () => {
            if (
                disposed ||
                getUnitId() !== unitId ||
                pendingRegistrations.get(portName) !== registration ||
                !element.isConnected
            ) return;
            const unitElement = element.closest(".unit-container");
            if (!unitElement) return;
            const portRect = element.getBoundingClientRect();
            const unitRect = unitElement.getBoundingClientRect();
            const x = portRect.left + portRect.width / 2 - unitRect.left;
            const y = portRect.top + portRect.height / 2 - unitRect.top;
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            updatePortOffset(unitId, portName, { x, y });
        };
        const releaseIfSettled = () => {
            if (
                registration.rafId === undefined &&
                registration.timerId === undefined &&
                pendingRegistrations.get(portName) === registration
            ) {
                pendingRegistrations.delete(portName);
            }
        };

        update();
        registration.rafId = requestAnimationFrame(() => {
            registration.rafId = undefined;
            update();
            releaseIfSettled();
        });
        registration.timerId = window.setTimeout(() => {
            registration.timerId = undefined;
            update();
            releaseIfSettled();
        }, 50);
    };

    const dispose = () => {
        disposed = true;
        pendingRegistrations.forEach(cancelRegistration);
        pendingRegistrations.clear();
    };

    return { register, dispose };
};
