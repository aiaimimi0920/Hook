import type { BarcodeResult, BarcodeScanResult } from "../types/unit";

export const BARCODE_OUTPUT_PORTS = [
    { name: "recognized_url", label: "URL", type: "text" },
    { name: "recognized_text", label: "Code text", type: "text" },
    { name: "recognized_codes", label: "All codes", type: "any" },
] as const;

export const buildBarcodeOutputValues = (
    scan: BarcodeScanResult,
): Record<string, unknown> => {
    const primary = scan.results.find((result) => result.id === scan.selectedId) ?? scan.results[0];
    return {
        recognized_url: primary?.url ?? null,
        recognized_text: primary?.text ?? null,
        recognized_codes: scan.results,
    };
};

export const getPrimaryBarcodeResult = (scan: BarcodeScanResult | undefined): BarcodeResult | undefined =>
    scan?.results.find((result) => result.id === scan.selectedId) ?? scan?.results[0];

export const hasBarcodeResults = (scan: BarcodeScanResult | undefined): boolean =>
    Boolean(scan?.results.length);
