import { describe, expect, it, vi } from "vitest";

import { createSingleFlightAction } from "../../src/services/singleFlightAction";

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

describe("single-flight action", () => {
    it("runs only the first overlapping mutation and releases the gate afterward", async () => {
        const pendingChanges: boolean[] = [];
        const gate = createSingleFlightAction((pending) => pendingChanges.push(pending));
        const firstResult = deferred<number>();
        const firstAction = vi.fn(() => firstResult.promise);
        const overlappingAction = vi.fn(async () => 2);

        const firstRun = gate.run(firstAction);
        const overlappingRun = gate.run(overlappingAction);

        expect(gate.isPending()).toBe(true);
        expect(await overlappingRun).toBeUndefined();
        expect(overlappingAction).not.toHaveBeenCalled();

        firstResult.resolve(1);
        await expect(firstRun).resolves.toBe(1);
        await expect(gate.run(async () => 3)).resolves.toBe(3);
        expect(pendingChanges).toEqual([true, false, true, false]);
    });

    it("releases after rejection and suppresses lifecycle notifications after disposal", async () => {
        const onPendingChange = vi.fn();
        const gate = createSingleFlightAction(onPendingChange);
        const result = deferred<void>();
        const run = gate.run(() => result.promise);

        gate.dispose();
        result.reject(new Error("failed"));
        await expect(run).rejects.toThrow("failed");
        expect(gate.isPending()).toBe(false);
        expect(onPendingChange).toHaveBeenCalledTimes(1);
        await expect(gate.run(async () => undefined)).resolves.toBeUndefined();
    });
});
