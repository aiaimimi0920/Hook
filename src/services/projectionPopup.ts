/** Projection dialogs share one visible slot; dismissing UI never stops established sync jobs. */
let active: { close: () => void } | undefined;

export function dismissProjectionPopup(): void {
    const previous = active;
    active = undefined;
    previous?.close();
}

export function claimProjectionPopup(close: () => void): () => void {
    dismissProjectionPopup();
    const owner = { close };
    active = owner;
    // Late cleanup from the replaced popup must not release its successor.
    return () => { if (active === owner) active = undefined; };
}
