import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readLoomConnectorRustSources } from "../helpers/loomConnectorRustSources";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Hook local capability API contract", () => {
  it("keeps Talk/Loom frontend bridging in the typed API clients without redundant connector facades", () => {
    const apiSource = readSource("src/services/api.ts");
    const apiTypesSource = readSource("src/services/apiTypes.ts");
    const loomApiSource = readSource("src/services/apiLoomSurface.ts");
    const voiceApiSource = readSource("src/services/apiVoice.ts");
    const libSource = readHookLibRustSources();
    const loomRustSource = readLoomConnectorRustSources();
    const talkRustSource = readSource("src-tauri/src/talk_connector.rs");
    const loomFrontendPath = resolve(process.cwd(), "src", "services", "loomConnector.ts");
    const talkFrontendPath = resolve(process.cwd(), "src", "services", "talkConnector.ts");

    expect(existsSync(loomFrontendPath)).toBe(false);
    expect(existsSync(talkFrontendPath)).toBe(false);

    expect(apiTypesSource).toContain("export interface LoomBrainPlanRequest");
    expect(apiTypesSource).toContain("export interface LoomBrainPlanResult");
    expect(loomApiSource).toContain("invokeLoomBrainPlan");
    expect(loomApiSource).toContain('safeInvoke("loom_brain_plan"');

    expect(apiTypesSource).toContain("export interface TalkVoiceCaptureRequest");
    expect(apiTypesSource).toContain("export interface TalkVoiceCaptureResult");
    expect(voiceApiSource).toContain("captureTalkVoiceOnce");
    expect(voiceApiSource).toContain('safeInvoke("talk_capture_voice_once"');

    expect(apiSource).toContain("...loomPlanningApi");
    expect(apiSource).toContain("...voiceApi");

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
