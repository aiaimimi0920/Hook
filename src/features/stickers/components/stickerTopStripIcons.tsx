import type { Component } from "solid-js";

export interface TopStripIconProps {
    class?: string;
}

export const SelectModeIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
        <path d="M5 3v17l5-6h9L5 3Z" />
    </svg>
);

export const MoveModeIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3v18" />
        <path d="M12 3l-2.8 2.8" />
        <path d="M12 3l2.8 2.8" />
        <path d="M12 21l-2.8-2.8" />
        <path d="M12 21l2.8-2.8" />
        <path d="M3 12h18" />
        <path d="M3 12l2.8-2.8" />
        <path d="M3 12l2.8 2.8" />
        <path d="M21 12l-2.8-2.8" />
        <path d="M21 12l-2.8 2.8" />
    </svg>
);

export const RotateModeIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 7A8 8 0 0 0 7 5L3 9M3 4v5h5" />
        <path d="M4 17a8 8 0 0 0 13 2l4-4m0 5v-5h-5" />
    </svg>
);

export const ScaleModeIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 15 4 20" />
        <path d="M4 16v4h4" />
        <path d="m15 9 5-5" />
        <path d="M16 4h4v4" />
    </svg>
);

export const RectToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="5" y="6" width="14" height="12" rx="0.5" />
    </svg>
);

export const EllipseToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <ellipse cx="12" cy="12" rx="7" ry="5.5" />
    </svg>
);

export const TriangleToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
        <path d="M12 5.5 19 18H5L12 5.5Z" />
    </svg>
);

export const PolygonToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
        <path d="M12 4.5 18.5 8.5 16.5 17 7.5 17 5.5 8.5 12 4.5Z" />
    </svg>
);

export const LineToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M5 18 19 6" />
    </svg>
);

export const BrushToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.35"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="m18.5 3.5 2 2L6 20l-3 1 1-3L18.5 3.5Z" />
        <path d="m16.5 5.5 2 2M4 18l2 2" />
    </svg>
);

export const TextToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="M5 8V5h14v3" />
        <path d="M12 5v14" />
        <path d="M9 19h6" />
    </svg>
);

export const SerialToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <circle cx="12" cy="12" r="7.5" />
        <path d="m10 10 2-2v8" />
        <path d="M10 16h4" />
    </svg>
);

export const MosaicToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor">
        <rect x="3" y="3" width="8" height="8" fill-opacity="0.35" />
        <rect x="13" y="3" width="8" height="8" />
        <rect x="3" y="13" width="8" height="8" />
        <rect x="13" y="13" width="8" height="8" fill-opacity="0.35" />
    </svg>
);

export const BlurToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
    >
        <path d="M12 2C10 6 5 11 5 15a7 7 0 0 0 14 0c0-4-5-9-7-13Z" fill="currentColor" stroke="none" />
    </svg>
);

export const EraserToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="m14 3 7 7-10 10H7l-5-5L14 3Z" />
        <path d="m14 3 7 7-5 5-7-7 5-5Z" fill="currentColor" />
        <path d="M11 20h10" />
    </svg>
);

export const CropToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="M6 2v16h16" />
        <path d="M2 6h16v16" />
    </svg>
);

export const UndoToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="m8 5-5 5 5 5" />
        <path d="M3 10h10a5 5 0 0 1 0 10" />
    </svg>
);

export const RedoToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="m16 5 5 5-5 5" />
        <path d="M21 10H11a5 5 0 0 0 0 10" />
    </svg>
);

export const RasterizeSelectedToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="M12 3v8m-4-4 4 4 4-4" />
        <path d="m3 12 9 5 9-5" />
    </svg>
);

export const RasterizeAllToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="M12 3v8m-4-4 4 4 4-4" />
        <path d="m3 10 9 5 9-5" />
        <path d="m3 14 9 5 9-5" />
        <path d="m3 18 9 5 9-5" />
    </svg>
);

export const ChevronDownCornerIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 12 12" fill="currentColor">
        <path d="M2 4.5 6 8l4-3.5H2Z" />
    </svg>
);
