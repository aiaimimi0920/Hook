import { api, type TalkVoiceCaptureRequest, type TalkVoiceCaptureResult } from "./api";

export type { TalkVoiceCaptureRequest, TalkVoiceCaptureResult };

export interface TalkConnectorApiClient {
    captureTalkVoiceOnce: (request: TalkVoiceCaptureRequest) => Promise<TalkVoiceCaptureResult>;
}

export const createTalkConnector = (client: TalkConnectorApiClient) => ({
    captureVoiceOnce: (request: TalkVoiceCaptureRequest = {}): Promise<TalkVoiceCaptureResult> =>
        client.captureTalkVoiceOnce(request),
});

export const talkConnector = createTalkConnector(api);
