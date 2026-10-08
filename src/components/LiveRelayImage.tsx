import { onCleanup, onMount, type Component } from "solid-js";
import type { LiveRelayView } from "../services/liveRelay";
import { observeRelayImage } from "../services/liveRelayRenderEvidence";
import { liveRelayActions } from "../store/liveRelayStore";

export const LiveRelayImage: Component<{ view: LiveRelayView }> = (props) => {
    let image!: HTMLImageElement;
    let disconnect: () => void = () => undefined;
    let invalidate: () => void = () => undefined;
    const clear = () => { invalidate(); liveRelayActions.clearRenderProof(props.view.relayId); };
    onMount(() => {
        const observation = observeRelayImage(image, () => props.view,
            (proof) => liveRelayActions.recordRenderProof(proof));
        disconnect = observation.disconnect;
        invalidate = observation.invalidate;
        liveRelayActions.setRenderEvidenceSupport(props.view.relayId, observation.supported);
        image.ownerDocument.addEventListener("visibilitychange", clear);
    });
    onCleanup(() => {
        disconnect();
        image.ownerDocument.removeEventListener("visibilitychange", clear);
        clear();
    });
    return <img ref={(node) => { image = node; }} src={props.view.imageUrl}
        alt="远端源窗口实时画面" draggable={false} onError={clear} />;
};
