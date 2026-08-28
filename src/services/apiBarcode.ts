import type { BarcodeScanResult } from "../types/unit";
import { safeInvoke } from "./apiTransport";

/** Local-only barcode boundary. Browser preview returns an empty scan. */
export const barcodeApi = {
    decode: (imageBase64: string): Promise<BarcodeScanResult> =>
        safeInvoke(
            "decode_barcodes",
            { imageBase64 },
            () => ({ width: 0, height: 0, results: [] }),
            false,
        ),

    openUrl: (url: string): Promise<void> =>
        safeInvoke(
            "open_http_url",
            { url },
            () => {
                if (typeof window === "undefined") return;
                window.open(url, "_blank", "noopener,noreferrer");
            },
            false,
        ),
};
