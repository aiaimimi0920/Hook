import { describe, expect, it, vi } from "vitest";
import { api } from "../../src/services/api";
import {
  createTalkConnector,
  talkConnector,
  type TalkVoiceCaptureRequest,
  type TalkVoiceCaptureResult,
} from "../../src/services/talkConnector";

const voiceCaptureResult: TalkVoiceCaptureResult = {
  requestId: "talk-request-1",
  status: "succeeded",
  text: "hello from talk",
  transcript: "hello from talk",
  sessionId: "talk-session-1",
  evidencePath: ".runtime/talk/logs/session.json",
  triggerEvents: ["toggle_start", "toggle_stop"],
  error: null,
};

describe("talkConnector", () => {
  it("delegates voice capture to an injected API client", async () => {
    const request: TalkVoiceCaptureRequest = {
      requestId: "talk-request-1",
      mode: "dictation",
      context: { source: "unit-test" },
      timeoutMs: 3000,
    };
    const captureTalkVoiceOnce = vi
      .fn<[TalkVoiceCaptureRequest], Promise<TalkVoiceCaptureResult>>()
      .mockResolvedValue(voiceCaptureResult);

    const connector = createTalkConnector({ captureTalkVoiceOnce });

    await expect(connector.captureVoiceOnce(request)).resolves.toBe(voiceCaptureResult);
    expect(captureTalkVoiceOnce).toHaveBeenCalledWith(request);
  });

  it("uses the Hook API object by default", async () => {
    const captureTalkVoiceOnce = vi
      .spyOn(api, "captureTalkVoiceOnce")
      .mockResolvedValue(voiceCaptureResult);

    try {
      await expect(talkConnector.captureVoiceOnce()).resolves.toBe(voiceCaptureResult);
      expect(captureTalkVoiceOnce).toHaveBeenCalledWith({});
    } finally {
      captureTalkVoiceOnce.mockRestore();
    }
  });
});
