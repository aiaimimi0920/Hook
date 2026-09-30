import { createStore } from "solid-js/store";

import type {
    LiveRelayDiscovery,
    LiveRelayFrameDescriptor,
    LiveRelaySnapshot,
    LiveRelayView,
} from "../services/liveRelay";

const [liveRelayViews, setLiveRelayViews] = createStore<LiveRelayView[]>([]);
const [liveRelayDiscovery, setLiveRelayDiscovery] = createStore<LiveRelayDiscovery>({
    protocolVersion: "loom.live.v1",
    sessions: [],
});
let nextZIndex = 2_200_000;

export const liveRelayActions = {
    setDiscovery(discovery: LiveRelayDiscovery): void {
        setLiveRelayDiscovery(discovery);
    },
    add(status: LiveRelaySnapshot, title: string, geometry: Pick<LiveRelayView, "x" | "y" | "width" | "height">): void {
        nextZIndex += 1;
        setLiveRelayViews((views) => [...views, {
            relayId: status.relayId,
            status,
            title,
            renderedFrameId: 0,
            frameWidth: 1,
            frameHeight: 1,
            ...geometry,
            pinned: false,
            zIndex: nextZIndex,
        }]);
    },
    updateStatus(relayId: string, status: LiveRelaySnapshot): void {
        setLiveRelayViews((view) => view.relayId === relayId, "status", status);
    },
    updateFrame(relayId: string, imageUrl: string, frame: LiveRelayFrameDescriptor): void {
        setLiveRelayViews((view) => view.relayId === relayId, {
            imageUrl,
            renderedFrameId: frame.frameId,
            frameWidth: frame.width,
            frameHeight: frame.height,
        });
    },
    clearFrame(relayId: string): void {
        setLiveRelayViews((view) => view.relayId === relayId, "imageUrl", undefined);
    },
    setError(relayId: string, error?: string): void {
        setLiveRelayViews((view) => view.relayId === relayId, "controlError", error);
    },
    updateGeometry(relayId: string, geometry: Pick<LiveRelayView, "x" | "y" | "width" | "height">): void {
        setLiveRelayViews((view) => view.relayId === relayId, geometry);
    },
    bringToFront(relayId: string): void {
        nextZIndex += 1;
        setLiveRelayViews((view) => view.relayId === relayId, "zIndex", nextZIndex);
    },
    setPinned(relayId: string, pinned: boolean): void {
        nextZIndex += 1;
        setLiveRelayViews((view) => view.relayId === relayId, { pinned, zIndex: nextZIndex });
    },
    remove(relayId: string): void {
        setLiveRelayViews((views) => views.filter((view) => view.relayId !== relayId));
    },
    clear(): void {
        setLiveRelayViews([]);
        setLiveRelayDiscovery({ protocolVersion: "loom.live.v1", sessions: [] });
    },
};

export { liveRelayDiscovery, liveRelayViews };
