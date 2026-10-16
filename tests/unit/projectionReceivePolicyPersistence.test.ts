import { afterEach, beforeEach, expect, it, vi } from "vitest";
const key = "otter.projection-receive-policy.v1";
const load = () => import("../../src/features/projection/state/projectionReceivePolicyStore");
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it("defaults to manual approval without copying old transport participation into consent", async () => {
    localStorage.setItem("hook.projection-receiver.v1", JSON.stringify({ policy: "auto" }));
    expect((await load()).projectionReceivePolicy()).toBe("confirm");
});

it.each(["auto", "confirm", "reject"] as const)("restores %s after restart", async (policy) => {
    const store = await load(); store.saveProjectionReceivePolicy(policy);
    vi.resetModules(); expect((await load()).projectionReceivePolicy()).toBe(policy);
});

it.each(["invalid-json", JSON.stringify({ version: 1, policy: "unknown" }), JSON.stringify({ version: 2, policy: "auto" })])("rejects safely for invalid saved policy %s", async (saved) => {
    localStorage.setItem(key, saved);
    expect((await load()).projectionReceivePolicy()).toBe("reject");
});

it("invalidates in-flight consent even after changing away and back", async () => {
    const store = await load(); const before = store.projectionReceivePolicyRevision();
    store.saveProjectionReceivePolicy("auto"); store.saveProjectionReceivePolicy("confirm");
    expect(store.projectionReceivePolicyRevision()).toBe(before + 2);
});
