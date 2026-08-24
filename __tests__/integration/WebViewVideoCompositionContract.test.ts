import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rustSource = readHookLibRustSources();

const sourceBetween = (startMarker: string, endMarker: string) => {
  const start = rustSource.indexOf(startMarker);
  const end = rustSource.indexOf(endMarker, start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return rustSource.slice(start, end);
};

describe("Hook WebView video composition contract", () => {
  it("configures WebView2 for software composition before creating the transparent overlay webview", () => {
    const configureBlock = sourceBetween(
      "fn configure_webview2_video_safe_composition",
      "#[cfg_attr(mobile, tauri::mobile_entry_point)]",
    );
    const runBlock = sourceBetween("pub fn run()", "tauri::Builder::default()");

    expect(configureBlock).toContain("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
    expect(configureBlock).toContain("std::env::var");
    expect(configureBlock).toContain("std::env::set_var");
    expect(configureBlock).toContain("--disable-gpu");
    expect(configureBlock).toContain("--disable-gpu-compositing");
    expect(configureBlock).toContain("--disable-gpu-rasterization");
    expect(configureBlock).toContain("--disable-zero-copy");
    expect(configureBlock).toContain("existing_args");
    expect(configureBlock).toContain("combined_args");
    expect(configureBlock).toContain("webview2_video_safe_composition_args_applied");

    expect(runBlock).toContain("configure_webview2_video_safe_composition();");
  });
});
