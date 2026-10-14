import type { ArtParam } from "../services/protocol";

const types = {
    number: ["#06b6d4", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"],
    text: ["#cbd5e1", "M4 4h16v16H4Z"],
    boolean: ["#22c55e", "m12 2 10 10-10 10L2 12Z"],
    select: ["#f2aa66", "m12 2 11 19H1Z"],
    color: ["#f18fb8", "m7 2 10 0 6 10-6 10H7L1 12Z"],
    image: ["#b69af7", "m12 1 11 8-4 13H5L1 9Z"],
    data: ["#929a9f", "M8 2h8v6h6v8h-6v6H8v-6H2V8h6Z"],
} as const;
export type PropertyType = keyof typeof types;

/** The shape/color pair describes the value kind, never its enabled state. */
export const propertyType = (valueType?: string, widget?: string): PropertyType => {
    const type = (valueType ?? "").toLowerCase();
    if (["select", "radio"].includes(widget ?? "")) return "select";
    if (widget === "color" || type === "color") return "color";
    if (["file", "image_link"].includes(widget ?? "") || /image|texture/.test(type)) return "image";
    if (["checkbox", "switch"].includes(widget ?? "") || /^(bool|boolean)$/.test(type)) return "boolean";
    if (["slider", "number"].includes(widget ?? "") || /^(int|integer|float|double|number)$/.test(type)) return "number";
    if (["text", "textarea", "path"].includes(widget ?? "") || /^(str|string|text|path)$/.test(type)) return "text";
    return "data";
};
export const paramPropertyType = (param: ArtParam) => propertyType(undefined, param.widget);
export const UnitPropertyTypeIcon = (props: { type: PropertyType }) => <svg class="unit-property-type" viewBox="0 0 24 24"
    fill={types[props.type][0]} aria-hidden="true" data-property-type={props.type}><path d={types[props.type][1]} /></svg>;
