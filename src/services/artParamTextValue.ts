import type { ArtParam } from "./protocol";

const isJsonParam = (param: Pick<ArtParam, "data_type" | "widget">) =>
    param.data_type?.toLowerCase() === "json" ||
    param.data_type?.toLowerCase() === "object" ||
    param.data_type?.toLowerCase() === "array";

export const formatArtParamTextValue = (
    param: Pick<ArtParam, "data_type" | "widget">,
    value: unknown,
): string => {
    if (value === undefined || value === null) return "";
    if (!isJsonParam(param) || typeof value === "string") return String(value);

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
};

export type ParsedArtParamTextValue =
    | { ok: true; value: unknown }
    | { ok: false; error: string };

export const parseArtParamTextValue = (
    param: Pick<ArtParam, "data_type" | "widget">,
    value: string,
): ParsedArtParamTextValue => {
    if (!isJsonParam(param)) return { ok: true, value };

    try {
        return { ok: true, value: JSON.parse(value) };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : "Invalid JSON",
        };
    }
};
