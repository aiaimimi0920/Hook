/** Shared visual tokens for the top-strip presentation owners. */
export type TopStripOpenMenu =
    | "mode"
    | "shape"
    | "line"
    | "label"
    | "effect"
    | "history"
    | "rasterize"
    | "extension"
    | "view"
    | null;

export const toolbarButtonClass =
    "hook-toolbar-button flex h-[50px] w-[50px] items-center justify-center pb-1 pr-1 transition-colors";
export const toolbarButtonRightBorderClass = `${toolbarButtonClass} hook-actions-border border-r`;
export const toolbarButtonLeftBorderClass = `${toolbarButtonClass} hook-actions-border border-l`;
export const toolbarCornerToggleClass =
    "hook-toolbar-corner-toggle hook-actions-border absolute bottom-0 right-0 z-10 flex h-6 w-6 items-center justify-center border-l border-t transition-colors";
export const toolbarMenuClass =
    "hook-toolbar-menu pointer-events-auto absolute left-0 top-full z-[1215] mt-1 min-w-[132px]";
export const toolbarMenuItemClass =
    "hook-toolbar-menu-item flex h-10 w-full items-center gap-2 px-3 text-left text-[12px] transition-colors";
