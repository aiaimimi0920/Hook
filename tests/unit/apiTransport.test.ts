import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { safeInvoke, warnBrowserFallback } from "../../src/platform/tauri/apiTransport";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.mocked(invoke).mockReset(); });

it("uses the browser fallback without warning or invoking native code", async () => {
    vi.stubGlobal("window", {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fallback = vi.fn(async () => ({ ready: false }));
    await expect(safeInvoke("preview", undefined, fallback)).resolves.toEqual({ ready: false });
    expect(fallback).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
});

it("rejects unsupported commands without a fallback", async () => {
    vi.stubGlobal("window", {});
    await expect(safeInvoke("native_only", undefined)).rejects.toThrow("Tauri runtime unavailable for command: native_only");
    expect(invoke).not.toHaveBeenCalled();
});

it("preserves fallback rejection", async () => {
    vi.stubGlobal("window", {});
    const reason = new Error("preview unsupported");
    await expect(safeInvoke("preview", undefined, () => { throw reason; })).rejects.toBe(reason);
});

it("passes native arguments through without executing fallback", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const args = { id: "unit" };
    const fallback = vi.fn(() => "preview");
    vi.mocked(invoke).mockResolvedValue("native");
    await expect(safeInvoke("command", args, fallback)).resolves.toBe("native");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("command", args);
    expect(fallback).not.toHaveBeenCalled();
});

it("does not hide native rejection behind browser fallback", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const reason = new Error("native failure");
    vi.mocked(invoke).mockRejectedValue(reason);
    const fallback = vi.fn(() => "preview");
    await expect(safeInvoke("command", undefined, fallback)).rejects.toBe(reason);
    expect(fallback).not.toHaveBeenCalled();
});

it("retains explicit browser warning deduplication", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnBrowserFallback("transport-test-explicit-warning");
    warnBrowserFallback("transport-test-explicit-warning");
    expect(warn).toHaveBeenCalledOnce();
});
