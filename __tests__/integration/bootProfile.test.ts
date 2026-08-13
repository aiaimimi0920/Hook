import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { defaultBootProfile, normalizeBootProfile } from "../../src/services/bootProfile";

describe("Hook boot profile", () => {
  it("defaults to standalone overlay mode so directly launching hook.exe does not wait for Loom Hook", () => {
    expect(defaultBootProfile).toMatchObject({
      startupMode: "silent",
      initialUiMode: "overlay",
      autoStartCapture: false,
      loomHookEnabled: false,
      loomHookWsUrl: "ws://127.0.0.1:19820",
      nativeAcceptance: false,
    });
  });

  it("keeps the Rust direct-exe boot profile standalone unless HOOK_ENABLE_LOOM_HOOK explicitly enables it", () => {
    const rustSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8");

    expect(rustSource).toContain('read_env_bool("HOOK_ENABLE_LOOM_HOOK", false)');
  });

  it("normalizes partial or invalid raw profile values", () => {
    expect(
      normalizeBootProfile({
        startupMode: "unsupported",
        initialUiMode: "unknown",
        autoStartCapture: "nope" as never,
        loomHookEnabled: false,
        loomHookWsUrl: "",
      }),
    ).toMatchObject({
      startupMode: "silent",
      initialUiMode: "overlay",
      autoStartCapture: false,
      loomHookEnabled: false,
      loomHookWsUrl: "ws://127.0.0.1:19820",
      nativeAcceptance: false,
    });

    expect(
      normalizeBootProfile({
        startupMode: "visible",
        initialUiMode: "overlay",
        autoStartCapture: true,
        loomHookEnabled: true,
        loomHookWsUrl: "ws://127.0.0.1:19999",
        nativeAcceptance: true,
      }),
    ).toMatchObject({
        startupMode: "visible",
        initialUiMode: "overlay",
        autoStartCapture: true,
        loomHookEnabled: true,
        loomHookWsUrl: "ws://127.0.0.1:19999",
        nativeAcceptance: true,
    });
  });
});
