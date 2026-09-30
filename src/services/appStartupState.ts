import { createSignal } from "solid-js";

// Background content receivers must wait until disk restoration has finished.
export const [startupSessionReady, setStartupSessionReady] = createSignal(false);
