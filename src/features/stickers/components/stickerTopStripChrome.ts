/** Shared visual tokens for the top-strip presentation owners. */
export type TopStripOpenMenu =
    | "mode"
    | "shape"
    | "line"
    | "brush"
    | "label"
    | "effect"
    | "history"
    | "rasterize"
    | "extension"
    | "view"
    | "projection"
    | null;

export const toolbarButtonClass =
    "otter-toolbar-button flex h-7 w-7 items-center justify-center transition-colors";
export const toolbarButtonRightBorderClass = toolbarButtonClass;
export const toolbarButtonLeftBorderClass = toolbarButtonClass;
export const toolbarCornerToggleClass =
    "otter-toolbar-corner-toggle absolute bottom-0 right-0 z-10 flex h-3 w-3 items-center justify-center transition-colors";
export const toolbarMenuClass =
    "otter-toolbar-menu pointer-events-auto absolute left-0 top-full z-[1215] mt-1 min-w-[132px]";
export const toolbarMenuItemClass =
    "otter-toolbar-menu-item flex h-7 w-full items-center gap-2 px-2 text-left text-[12px] transition-colors";
