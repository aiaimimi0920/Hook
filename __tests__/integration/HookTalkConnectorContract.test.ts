import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Hook Talk connector contract", () => {
  it("exposes a Hook-owned Talk connector surface separate from ArtLoom", () => {
    const apiSource = readSource("src/services/api.ts");
    const libSource = readSource("src-tauri/src/lib.rs");
    const talkRustPath = resolve(process.cwd(), "src-tauri", "src", "talk_connector.rs");
    const talkFrontendPath = resolve(process.cwd(), "src", "services", "talkConnector.ts");

    expect(existsSync(talkRustPath)).toBe(true);
    expect(existsSync(talkFrontendPath)).toBe(true);

    const talkRustSource = readFileSync(talkRustPath, "utf8");
    const talkFrontendSource = readFileSync(talkFrontendPath, "utf8");

    expect(libSource).toContain("pub mod talk_connector;");
    expect(libSource).toContain("async fn talk_capture_voice_once");
    expect(libSource).toContain("talk_connector::capture_voice_once");
    expect(libSource).toContain("talk_capture_voice_once,");

    expect(apiSource).toContain("export interface TalkVoiceCaptureRequest");
    expect(apiSource).toContain("export interface TalkVoiceCaptureResult");
    expect(apiSource).toContain("triggerEvents?: string[]");
    expect(apiSource).toContain("captureTalkVoiceOnce");
    expect(apiSource).toContain('safeInvoke("talk_capture_voice_once"');

    expect(talkFrontendSource).toContain("export const talkConnector");
    expect(talkFrontendSource).toContain("captureVoiceOnce");
    expect(talkFrontendSource).toContain("captureTalkVoiceOnce");
    expect(talkFrontendSource).not.toContain("artLoomIpcRequest");
    expect(talkFrontendSource).not.toContain("browserArtLoomRequest");
    expect(talkFrontendSource).not.toContain("listenBrowserArtLoomMethod");

    expect(talkRustSource).toContain("validate_talk_manifest");
    expect(talkRustSource).toContain("is_loopback_base_url");
    expect(talkRustSource).toContain("build_voice_capture_once_envelope");
    expect(talkRustSource).toContain("voice.capture.once");
    expect(talkRustSource).not.toContain("mock_artloom");
  });
});
