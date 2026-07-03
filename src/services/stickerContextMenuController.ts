import { createStore } from "solid-js/store";

export type StickerContextSubmenu = "none" | "recycleBin" | "referenceLibrary";

export interface StickerContextMenuState {
    isOpen: boolean;
    targetStickerId: string | null;
    mouseX: number;
    mouseY: number;
    activeSubmenu: StickerContextSubmenu;
    submenuOffsetY: number;
}

export interface StickerContextMenuController {
    state: StickerContextMenuState;
    openForSticker: (stickerId: string, mouse: { x: number; y: number }) => void;
    openSubmenu: (submenu: StickerContextSubmenu, anchor?: { top: number }) => void;
    close: () => void;
}

const createInitialState = (): StickerContextMenuState => ({
    isOpen: false,
    targetStickerId: null,
    mouseX: 0,
    mouseY: 0,
    activeSubmenu: "none",
    submenuOffsetY: 0,
});

export const createStickerContextMenuController = (): StickerContextMenuController => {
    const [state, setState] = createStore<StickerContextMenuState>(createInitialState());

    return {
        state,
        openForSticker(stickerId, mouse) {
            setState({
                isOpen: true,
                targetStickerId: stickerId,
                mouseX: mouse.x,
                mouseY: mouse.y,
                activeSubmenu: "none",
                submenuOffsetY: 0,
            });
        },
        openSubmenu(submenu, anchor) {
            if (submenu === "none") {
                setState({
                    activeSubmenu: "none",
                    submenuOffsetY: 0,
                });
                return;
            }

            setState({
                activeSubmenu: submenu,
                submenuOffsetY: Math.max((anchor?.top ?? state.mouseY) - state.mouseY, 0),
            });
        },
        close() {
            setState(createInitialState());
        },
    };
};

export const stickerContextMenuController = createStickerContextMenuController();
