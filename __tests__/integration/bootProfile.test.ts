import { describe, expect, it } from "vitest";

import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { defaultBootProfile, normalizeBootProfile } from "../../src/services/bootProfile";

describe("Hook boot profile", () => {
  it("keeps browser preview and missing native profiles disconnected", () => {
    expect(defaultBootProfile).toMatchObject({
      startupMode: "silent",
      initialUiMode: "overlay",
      autoStartCapture: false,
      loomHookEnabled: false,
      loomHookWsUrl: "ws://127.0.0.1:19820",
      nativeAcceptance: false,
    });
  });

  it("uses the native connector policy for the desktop boot profile", () => {
    const rustSource = readHookLibRustSources();

    expect(rustSource).toContain('loom_hook_enabled: crate::loom_bridge_client::enabled()');
  });

  it("normalizes partial or invalid raw profile values", () => {
    expect(
      normalizeBootProfile({
        startupMode: "unsupported" as never,
        initialUiMode: "unknown" as never,
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
