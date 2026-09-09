import { createStore } from "solid-js/store";

import type { LiveCaptureStatus, LiveCaptureView } from "../services/liveCapture";

const [liveCaptureViews, setLiveCaptureViews] = createStore<LiveCaptureView[]>([]);

export const liveCaptureActions = {
    add(status: LiveCaptureStatus, geometry: Pick<LiveCaptureView, "x" | "y" | "width" | "height">): void {
        setLiveCaptureViews((views) => [
            ...views,
            {
                sessionId: status.sessionId,
                status,
                renderedFrameId: 0,
                ...geometry,
            },
        ]);
    },

    updateStatus(sessionId: string, status: LiveCaptureStatus): void {
        setLiveCaptureViews((view) => view.sessionId === sessionId, "status", status);
    },

    updateFrame(sessionId: string, imageUrl: string, renderedFrameId: number): void {
        setLiveCaptureViews((view) => view.sessionId === sessionId, {
            imageUrl,
            renderedFrameId,
        });
    },

    setControlError(sessionId: string, code?: string, message?: string): void {
        setLiveCaptureViews((view) => view.sessionId === sessionId, {
            controlErrorCode: code,
            controlErrorMessage: message,
        });
    },

    remove(sessionId: string): void {
        setLiveCaptureViews((views) => views.filter((view) => view.sessionId !== sessionId));
    },

    clear(): void {
        setLiveCaptureViews([]);
    },
};

export { liveCaptureViews };
