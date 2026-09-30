/** The normal Hook runtime owns relay workers; closing a Unit panel never disposes them. */
import { createSignal, untrack } from 'solid-js';
import type { LiveRelayController } from './liveRelayController';

const [owner, setOwner] = createSignal<LiveRelayController>();
export const liveRelayOwner = owner;
export function registerLiveRelayOwner(controller: LiveRelayController): () => void {
    setOwner(controller);
    return () => { if (untrack(owner) === controller) setOwner(undefined); };
}
