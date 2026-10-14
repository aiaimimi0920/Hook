import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { invoke } from "@tauri-apps/api/core";
import { LoomConnectionDialog } from "../../src/components/LoomConnectionDialog";
import { LoomConnectionSettings } from "../../src/components/LoomConnectionSettings";
import { connectLoom, disconnectLoom, loomConnectionState, loomManualOrigin, refreshLoomConnection, type LoomConnectionState } from "../../src/services/loomConnection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/services/api", () => ({ api: { focusOverlayWindow: vi.fn() } }));
vi.mock("../../src/services/stickerTopStripSync", () => ({ syncTopStripBackendRects: vi.fn() }));
const info = { protocolVersion: "loom.connection.v1", loomId: "loom-test", name: "Test Loom", endpoint: "https://loom.test", discoverable: true, approval: "manual", passwordRequired: true };
const target = { origin: "https://loom.test", name: "Test Loom", loomId: "loom-test" };
const idle: LoomConnectionState = { phase: "disconnected", loomId: null, name: null, origin: null, error: null, expiresAt: 0 };
let state: LoomConnectionState;
let dispose: (() => void) | undefined;
const button = (text: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === text)!;

beforeEach(async () => {
    state = { ...idle };
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "loom_connection_view") return { state, history: [target] };
        if (command === "loom_connection_discover") return [target];
        if (command === "loom_connection_probe") return info;
        if (command === "loom_connection_connect") { state = { ...idle, phase: "waiting" }; return undefined; }
        if (command === "loom_connection_disconnect") { state = { ...idle }; return undefined; }
        return undefined;
    });
    await disconnectLoom();
    vi.mocked(invoke).mockClear();
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("constructs explicit secure remote origins and supports local and IPv6 targets", () => {
    expect(loomManualOrigin("192.168.1.8", "8310")).toBe("https://192.168.1.8:8310");
    expect(loomManualOrigin("127.0.0.1", "8310")).toBe("http://127.0.0.1:8310");
    expect(loomManualOrigin("2001:db8::1", "443")).toBe("https://[2001:db8::1]:443");
    for (const port of ["0", "65536", "1x", ""]) expect(() => loomManualOrigin("host", port)).toThrow();
    expect(() => loomManualOrigin("user@host", "443")).toThrow();
});

it("all sticker settings show the same authenticated connection and never show pending as connected", async () => {
    dispose = render(() => <><LoomConnectionSettings frame={{ x: 20, y: 20, w: 300, h: 200 }} /><LoomConnectionSettings frame={{ x: 400, y: 20, w: 300, h: 200 }} /></>, document.body);
    await vi.waitFor(() => expect(document.querySelectorAll("code")).toHaveLength(2));
    state = { ...idle, phase: "waiting" };
    await refreshLoomConnection();
    expect([...document.querySelectorAll("code")].map((node) => node.textContent)).toEqual(["-", "-"]);
    state = { ...idle, phase: "connected", loomId: "loom-test", name: "Test Loom", expiresAt: Date.now() + 30_000 };
    await refreshLoomConnection();
    expect([...document.querySelectorAll("code")].map((node) => node.textContent)).toEqual(["loom-test", "loom-test"]);
    button("断连").click();
    await vi.waitFor(() => expect([...document.querySelectorAll("code")].map((node) => node.textContent)).toEqual(["-", "-"]));
});

it("probes a selected target, submits the password only to native and keeps approval pending after popup disposal", async () => {
    const close = vi.fn();
    dispose = render(() => <LoomConnectionDialog close={close} />, document.body);
    await vi.waitFor(() => expect(document.querySelector(".loom-target")).not.toBeNull());
    document.querySelector<HTMLButtonElement>(".loom-target")!.click();
    await vi.waitFor(() => expect(button("连接").disabled).toBe(false));
    const password = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    password.value = "private-example"; password.dispatchEvent(new Event("input", { bubbles: true }));
    button("连接").click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("等待 Loom 批准"));
    expect(invoke).toHaveBeenCalledWith("loom_connection_connect", { origin: target.origin, expectedId: info.loomId, password: "private-example" });
    expect(password.value).toBe(""); expect(close).not.toHaveBeenCalled();
    dispose(); dispose = undefined;
    expect(invoke).not.toHaveBeenCalledWith("loom_connection_disconnect");
    expect(loomConnectionState().phase).toBe("waiting");
});

it("a late failed connect cannot overwrite a subsequent disconnect", async () => {
    let reject!: (error: Error) => void;
    const original = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args, options) => command === "loom_connection_connect"
        ? new Promise((_resolve, fail) => { reject = fail; }) : original(command, args, options));
    const attempt = connectLoom(target.origin, info.loomId, "").catch(() => undefined);
    await disconnectLoom();
    reject(new Error("stale failure")); await attempt;
    expect(loomConnectionState().phase).toBe("disconnected");
    expect(loomConnectionState().error).toBeNull();
});

it("ignores a late probe after changing the manual address", async () => {
    let resolve!: (result: typeof info) => void;
    const original = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args, options) => command === "loom_connection_probe"
        ? new Promise((done) => { resolve = done; }) : original(command, args, options));
    dispose = render(() => <LoomConnectionDialog close={() => undefined} />, document.body);
    button("手动").click();
    const host = document.querySelector<HTMLInputElement>('[aria-label="Loom IP 或主机名"]')!;
    const port = document.querySelector<HTMLInputElement>('[aria-label="Loom 端口"]')!;
    host.value = "loom.test"; host.dispatchEvent(new Event("input", { bubbles: true }));
    port.value = "443"; port.dispatchEvent(new Event("input", { bubbles: true }));
    button("查找").click();
    host.value = "another.test"; host.dispatchEvent(new Event("input", { bubbles: true }));
    resolve(info);
    await Promise.resolve(); await Promise.resolve();
    expect(button("连接").disabled).toBe(true);
    expect(button("查找").disabled).toBe(false);
});
