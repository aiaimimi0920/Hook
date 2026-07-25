import type { Component } from "solid-js";

export interface TopStripIconProps {
    class?: string;
}

export const SelectModeIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M6 3.5V19l4.2-3.8 3.1 5.3 2.5-1.5-3.1-5.3 5.8-.6L6 3.5Z" fill="currentColor" stroke="none" />
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
        <path d="M19 10a7 7 0 1 0 1 4" />
        <path d="M20 4v6h-6" />
    </svg>
);

export const ScaleModeIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 15 4 20" />
        <path d="M4 16v4h4" />
        <path d="m15 9 5-5" />
        <path d="M16 4h4v4" />
        <path d="m9 9-5-5" />
        <path d="M4 8V4h4" />
        <path d="m15 15 5 5" />
        <path d="M20 16v4h-4" />
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
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="M15.2 4.2 19.8 8.8 9.6 19l-4.4.8.8-4.4L15.2 4.2Z" />
        <path d="M8 15.8c-1.4.3-3 1.4-3 3.4" />
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
        <path d="M5 6h14" />
        <path d="M12 6v12" />
        <path d="M8 18h8" />
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
        <path d="M10.2 9.2h1.9v5.6" />
        <path d="M9.7 14.8h3.2" />
    </svg>
);

export const MosaicToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor">
        <rect x="5" y="5" width="5" height="5" rx="0.8" />
        <rect x="11.5" y="5" width="7.5" height="5" rx="0.8" />
        <rect x="5" y="11.5" width="5" height="7.5" rx="0.8" />
        <rect x="11.5" y="11.5" width="7.5" height="7.5" rx="0.8" />
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
        <circle cx="12" cy="12" r="3.3" />
        <path d="M5 12h2" />
        <path d="M17 12h2" />
        <path d="M12 5v2" />
        <path d="M12 17v2" />
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
        <path d="M8.5 5h6l4 4-7.5 7.5H6.5L4 14l4.5-9Z" />
        <path d="M11.5 16.5H19" />
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
        <path d="M7 4.5v10.8a2.2 2.2 0 0 0 2.2 2.2H20" />
        <path d="M4.5 7H15a2 2 0 0 1 2 2v10.5" />
        <path d="M10 12.5h6.5" />
        <path d="M12.5 10v5" />
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
        <path d="M9 7H5v4" />
        <path d="M5 11a8 8 0 1 1 2.4 5.7" />
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
        <path d="M15 7h4v4" />
        <path d="M19 11a8 8 0 1 0-2.4 5.7" />
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
        <rect x="4.5" y="5" width="8" height="8" rx="1.2" />
        <path d="M15.5 7.5h4" />
        <path d="M15.5 11h4" />
        <path d="M6.8 15.8h10.4" />
        <path d="M8.2 18.8h7.6" />
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
        <rect x="4.5" y="5" width="6.5" height="6.5" rx="1.1" />
        <rect x="13" y="5" width="6.5" height="6.5" rx="1.1" />
        <rect x="4.5" y="13.5" width="6.5" height="6.5" rx="1.1" />
        <rect x="13" y="13.5" width="6.5" height="6.5" rx="1.1" />
    </svg>
);

export const ChevronDownCornerIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 12 12" fill="currentColor">
        <path d="M2 4.5 6 8l4-3.5H2Z" />
    </svg>
);
