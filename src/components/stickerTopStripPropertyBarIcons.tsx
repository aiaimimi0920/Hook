import type { Component } from "solid-js";

export type MiniIconProps = {
    class?: string;
};

export const StrokeColorIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
        <rect x="3" y="3" width="10" height="10" rx="1.2" />
    </svg>
);

export const FillColorIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="currentColor">
        <rect x="3" y="3" width="10" height="10" rx="1.2" />
    </svg>
);

export const SquareConstraintGlyphIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none">
        <text
            x="8"
            y="11"
            fill="currentColor"
            font-size="10"
            font-weight="700"
            text-anchor="middle"
        >
            正
        </text>
    </svg>
);

export const StepIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 11.5 6 8.5 8 10 12.5 5.5" />
        <path d="M12.5 5.5V8.5" />
    </svg>
);

export const LineWidthIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round">
        <path d="M3 12.5h10" stroke-width="2.4" />
        <path d="M3 8h10" stroke-width="1.5" />
        <path d="M3 4h10" stroke-width="0.9" />
    </svg>
);

export const AngleSnapIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 12V4h8" />
        <path d="M4 12 12 4" />
        <path d="M6.5 12A2.5 2.5 0 0 0 4 9.5" />
    </svg>
);

export const ArrowHeadIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12 12 3" />
        <path d="M8.5 3H12v3.5" />
    </svg>
);

export const BrushIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.5 3.5 13 6l-5.5 5.5-2.5.5.5-2.5L10.5 3.5Z" />
        <path d="M5.5 10.5c-.7.2-1.5.8-1.5 1.8" />
    </svg>
);

export const HighlighterGlowIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3.2v2" />
        <path d="M11.4 4.6 10 6" />
        <path d="M12.8 8h-2" />
        <path d="M5.8 9.6 9.6 5.8 12.2 8.4 8.4 12.2H5.6Z" />
        <path d="M4.2 12.6h4.2" />
    </svg>
);

export const TextIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 4h10" />
        <path d="M8 4v8" />
        <path d="M5.5 12h5" />
    </svg>
);

export const RadiusIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 12V6a2 2 0 0 1 2-2h6" />
        <path d="M6 12h6" />
        <path d="M12 4v4" />
    </svg>
);

export const PolygonSidesIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="8,2.5 12.5,5 12.5,11 8,13.5 3.5,11 3.5,5" />
        <circle cx="8" cy="2.5" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="12.5" cy="5" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="12.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="8" cy="13.5" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="3.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="3.5" cy="5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
);

export const BlurIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
        <circle cx="8" cy="8" r="2.3" />
        <path d="M3 8h1.2M11.8 8H13" />
        <path d="M8 3v1.2M8 11.8V13" />
    </svg>
);

export const MosaicIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="currentColor">
        <rect x="3" y="3" width="4" height="4" rx="0.5" />
        <rect x="8.5" y="3" width="4.5" height="4" rx="0.5" />
        <rect x="3" y="8.5" width="4" height="4.5" rx="0.5" />
        <rect x="8.5" y="8.5" width="4.5" height="4.5" rx="0.5" />
    </svg>
);

export const EraserIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6.2 4.2h4.2l2.1 2.1-5.4 5.5H3.9L2.5 10.4 6.2 4.2Z" />
        <path d="M8 11.8h4.5" />
    </svg>
);

export const AnnotationsOnlyFocusedIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" opacity="0.35" />
        <rect x="4.2" y="4.2" width="5.2" height="5.2" rx="0.9" stroke-dasharray="1.1 1.1" />
        <path d="M10.3 9.8 12.9 7.2" />
        <path d="M10.7 6.8h1.7l.8.8-2.5 2.5H9.9l-.6-.6 1.4-2.7Z" />
    </svg>
);

export const FlipXIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 2.8v10.4" />
        <path d="m6.1 5.3-2.8 2.8 2.8 2.8" />
        <path d="m9.9 5.3 2.8 2.8-2.8 2.8" />
    </svg>
);

export const FlipYIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2.8 8h10.4" />
        <path d="m5.3 6.1 2.8-2.8 2.8 2.8" />
        <path d="m5.3 9.9 2.8 2.8 2.8-2.8" />
    </svg>
);

export const ResetCropIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4.5 3.5h7v7" />
        <path d="M11.5 12.5h-7v-7" />
        <path d="M5 5 3 7l2 2" />
    </svg>
);

export const OpacityIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 2.7 11.8 6.8A4.8 4.8 0 1 1 4.2 6.8L8 2.7Z" />
        <path d="M8 4.8v6.5" opacity="0.55" />
    </svg>
);

export const CanvasSizeIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="10" height="8" rx="1.2" />
        <path d="M5 8h6" />
        <path d="M9 6l2 2-2 2" />
    </svg>
);
