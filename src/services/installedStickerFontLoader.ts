import { api } from "./api";
import { setInstalledStickerFonts } from "../store/uiStore";

let loaded = false;
let pendingLoad: Promise<void> | null = null;

/** Shares one lazy system-font request across every property-bar mount. */
export const loadInstalledStickerFonts = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    if (pendingLoad) return pendingLoad;

    pendingLoad = api.getInstalledFonts()
        .then((fonts) => {
            setInstalledStickerFonts(fonts);
            loaded = true;
        })
        .finally(() => {
            pendingLoad = null;
        });
    return pendingLoad;
};
