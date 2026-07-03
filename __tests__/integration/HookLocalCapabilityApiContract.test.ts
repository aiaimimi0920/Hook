import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Hook local capability API contract", () => {
  it("keeps Talk/Loom frontend bridging inside api.ts without redundant façade files", () => {
    const apiSource = readSource("src/services/api.ts");
    const libSource = readSource("src-tauri/src/lib.rs");
    const loomRustSource = readSource("src-tauri/src/loom_connector.rs");
    const talkRustSource = readSource("src-tauri/src/talk_connector.rs");
    const loomFrontendPath = resolve(process.cwd(), "src", "services", "loomConnector.ts");
    const talkFrontendPath = resolve(process.cwd(), "src", "services", "talkConnector.ts");

    expect(existsSync(loomFrontendPath)).toBe(false);
    expect(existsSync(talkFrontendPath)).toBe(false);

    expect(apiSource).toContain("export interface LoomBrainPlanRequest");
    expect(apiSource).toContain("export interface LoomBrainPlanResult");
    expect(apiSource).toContain("invokeLoomBrainPlan");
    expect(apiSource).toContain('safeInvoke("loom_brain_plan"');

    expect(apiSource).toContain("export interface TalkVoiceCaptureRequest");
    expect(apiSource).toContain("export interface TalkVoiceCaptureResult");
    expect(apiSource).toContain("captureTalkVoiceOnce");
    expect(apiSource).toContain('safeInvoke("talk_capture_voice_once"');

    expect(libSource).toContain("pub mod loom_connector;");
    expect(libSource).toContain("async fn loom_brain_plan");
    expect(libSource).toContain("loom_connector::invoke_brain_plan");
    expect(libSource).toContain("loom_brain_plan,");

    expect(libSource).toContain("pub mod talk_connector;");
    expect(libSource).toContain("async fn talk_capture_voice_once");
    expect(libSource).toContain("talk_connector::capture_voice_once");
    expect(libSource).toContain("talk_capture_voice_once,");

    expect(loomRustSource).toContain("validate_loom_manifest");
    expect(loomRustSource).toContain("is_loopback_base_url");
    expect(loomRustSource).toContain("build_brain_plan_envelope");
    expect(loomRustSource).toContain("brain.plan");

    expect(talkRustSource).toContain("validate_talk_manifest");
    expect(talkRustSource).toContain("is_loopback_base_url");
    expect(talkRustSource).toContain("build_voice_capture_once_envelope");
    expect(talkRustSource).toContain("voice.capture.once");
  });
});
