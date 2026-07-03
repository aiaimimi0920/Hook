import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { defaultBootProfile, normalizeBootProfile } from "../../src/services/bootProfile";

describe("Hook boot profile", () => {
  it("defaults to standalone overlay mode so directly launching hook.exe does not wait for ArtLoom", () => {
    expect(defaultBootProfile).toMatchObject({
      startupMode: "silent",
      initialUiMode: "overlay",
      autoStartCapture: false,
      artLoomEnabled: false,
      artLoomWsUrl: "ws://127.0.0.1:19820",
    });
  });

  it("keeps the Rust direct-exe boot profile standalone unless HOOK_ENABLE_ARTLOOM explicitly enables it", () => {
    const rustSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8");

    expect(rustSource).toContain('read_env_bool("HOOK_ENABLE_ARTLOOM", false)');
  });

  it("normalizes partial or invalid raw profile values", () => {
    expect(
      normalizeBootProfile({
        startupMode: "unsupported",
        initialUiMode: "unknown",
        autoStartCapture: "nope" as never,
        artLoomEnabled: false,
        artLoomWsUrl: "",
      }),
    ).toMatchObject({
      startupMode: "silent",
      initialUiMode: "overlay",
      autoStartCapture: false,
      artLoomEnabled: false,
      artLoomWsUrl: "ws://127.0.0.1:19820",
    });

    expect(
      normalizeBootProfile({
        startupMode: "visible",
        initialUiMode: "overlay",
        autoStartCapture: true,
        artLoomEnabled: true,
        artLoomWsUrl: "ws://127.0.0.1:19999",
      }),
    ).toMatchObject({
        startupMode: "visible",
        initialUiMode: "overlay",
        autoStartCapture: true,
        artLoomEnabled: true,
        artLoomWsUrl: "ws://127.0.0.1:19999",
    });
  });
});
