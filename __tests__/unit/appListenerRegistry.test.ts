import { describe, expect, it, vi } from "vitest";

import { AppListenerRegistry } from "../../src/services/appListenerRegistry";

describe("AppListenerRegistry", () => {
    it("disposes earlier listeners when a later registration fails", async () => {
        const firstDisposer = vi.fn();
        const registry = new AppListenerRegistry();
        await registry.register(async () => firstDisposer);

        const failure = new Error("registration failed");
        await expect(registry.register(async () => {
            throw failure;
        })).rejects.toBe(failure);

        expect(firstDisposer).toHaveBeenCalledTimes(1);
        expect(registry.isDisposed).toBe(true);
    });

    it("immediately disposes a listener that resolves after unmount", async () => {
        let resolveRegistration!: (disposer: () => void) => void;
        const pendingRegistration = new Promise<() => void>((resolve) => {
            resolveRegistration = resolve;
        });
        const disposer = vi.fn();
        const registry = new AppListenerRegistry();
        const registration = registry.register(() => pendingRegistration);

        registry.dispose();
        resolveRegistration(disposer);
        await registration;

        expect(disposer).toHaveBeenCalledTimes(1);
    });

    it("is idempotent across repeated mount and unmount cycles", () => {
        const disposers = Array.from({ length: 3 }, () => vi.fn());

        for (const disposer of disposers) {
            const registry = new AppListenerRegistry();
            registry.push(disposer, disposer);
            registry.dispose();
            registry.dispose();
        }

        expect(disposers.map((disposer) => disposer.mock.calls.length)).toEqual([1, 1, 1]);
    });

    it("continues reverse-order cleanup after a disposer throws", () => {
        const calls: string[] = [];
        const cleanupError = new Error("cleanup failed");
        const onCleanupError = vi.fn();
        const registry = new AppListenerRegistry({ onCleanupError });
        registry.push(
            () => calls.push("first"),
            () => {
                calls.push("second");
                throw cleanupError;
            },
            () => calls.push("third"),
        );

        registry.dispose();

        expect(calls).toEqual(["third", "second", "first"]);
        expect(onCleanupError).toHaveBeenCalledWith(cleanupError);
    });

    it("does not start new registrations after disposal", async () => {
        const setup = vi.fn(async () => vi.fn());
        const registry = new AppListenerRegistry();
        registry.dispose();

        const disposer = await registry.register(setup);
        disposer();

        expect(setup).not.toHaveBeenCalled();
    });
});
