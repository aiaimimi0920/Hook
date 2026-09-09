import { onCleanup, type Component } from "solid-js";

import { createLiveRelayController } from "../services/liveRelayController";
import { LiveRelayLayer } from "./LiveRelayLayer";

export const LiveFeatures: Component = () => {
    const relay = createLiveRelayController();
    onCleanup(relay.dispose);
    return <LiveRelayLayer controller={relay} />;
};
