import { afterEach, beforeEach, expect, it, vi } from "vitest";
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { localStorage.clear(); });
const paused = async () => (await import("../../src/store/managedProjectionReceiverStore")).projectionReceiverPaused();
it("fresh installs follow Loom without needing an address or policy in Hook", async () => {
    expect(await paused()).toBe(false);
});
it("preserves an explicitly saved legacy disable as a local pause", async () => {
    localStorage.setItem("hook.projection-receiver.v1", JSON.stringify({ origin: "https://old.example.test", policy: "disabled" }));
    expect(await paused()).toBe(true);
});
it("legacy auto does not bypass Loom policy and an explicit managed preference wins", async () => {
    localStorage.setItem("hook.projection-receiver.v1", JSON.stringify({ origin: "https://old.example.test", policy: "auto" }));
    expect(await paused()).toBe(false);
    vi.resetModules(); localStorage.setItem("hook.projection-receiver.managed.v1", JSON.stringify({ paused: true }));
    expect(await paused()).toBe(true);
});
it("corrupt saved participation state stays paused", async () => {
    localStorage.setItem("hook.projection-receiver.managed.v1", "invalid-json");
    expect(await paused()).toBe(true);
});
