import { onCleanup, type Component } from "solid-js";

import { createLiveRelayController } from "../services/liveRelayController";
import { registerLiveRelayOwner } from "../services/liveRelayOwner";
import { LiveRelayLayer } from "./LiveRelayLayer";

export const LiveFeatures: Component = () => {
    const relay = createLiveRelayController();
    onCleanup(registerLiveRelayOwner(relay));
    onCleanup(relay.dispose);
    return <LiveRelayLayer controller={relay} />;
};
