import { Show, createEffect, createMemo, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { api } from "../services/api";
import { renderStickerComposite } from "../services/stickerExport";
import {
    addRecycleBinEntry,
    cancelReferenceEntry,
    copyReferenceEntry,
    removeFrozenStickerEntry,
    restoreRecycleBinEntry,
    setReferenceEntry,
} from "../services/stickerLibraryModel";
import { stickerContextMenuController } from "../services/stickerContextMenuController";
import { captureFrozenStickerSnapshot } from "../services/stickerSnapshot";
import { syncService } from "../services/syncService";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { graphStore } from "../store/graphStore";
import { selectionActions, uiActions } from "../store/uiStore";
import { StickerContextMenuPanel } from "./StickerContextMenuPanel";
import { StickerSnapshotListPanel } from "./StickerSnapshotListPanel";

const CONTEXT_MENU_RECT_ID = "sticker-context-menu-root";
const CONTEXT_MENU_RECT_NAME = "STICKER_CONTEXT_MENU_ROOT";

export const StickerContextMenuLayer = () => {
    let menuRootRef: HTMLDivElement | undefined;

    const closeMenu = () => {
        stickerContextMenuController.close();
    };

    const menuMouse = () => ({
        x: stickerContextMenuController.state.mouseX,
        y: stickerContextMenuController.state.mouseY,
    });

    const targetSticker = createMemo(() => {
        const targetStickerId = stickerContextMenuController.state.targetStickerId;
        if (!targetStickerId) {
            return undefined;
        }

        return graphStore.units.find((unit) => unit.id === targetStickerId && unit.type === "sticker");
    });

    const referenceActionLabel = createMemo(() => {
        const target = targetSticker();
        if (!target) {
            return "设置参考";
        }

        return graphStore.referenceLibrary.some((entry) => entry.sourceStickerId === target.id)
            ? "取消参考"
            : "设置参考";
    });

    const activeSubmenuEntries = createMemo(() => {
        switch (stickerContextMenuController.state.activeSubmenu) {
            case "recycleBin":
                return graphStore.recycleBin;
            case "referenceLibrary":
                return graphStore.referenceLibrary;
            default:
                return [];
        }
    });

    const persistSession = () => {
        void syncService.performWorkflowSync();
    };

    const persistLayoutAndSession = () => {
        void syncService.updateBackendRects();
        void syncService.performWorkflowSync();
    };

    const handleCloseSticker = () => {
        const target = targetSticker();
        if (!target) {
            closeMenu();
            return;
        }

        graphStore.setRecycleBin(addRecycleBinEntry(graphStore.recycleBin, captureFrozenStickerSnapshot(target)));
        graphStore.actions.removeUnit(target.id);
        uiActions.clearStickerHistory(target.id);
        selectionActions.clear();
        uiActions.hideStickerToolbar();
        closeMenu();
        persistLayoutAndSession();
    };

    const handleSave = async () => {
        const target = targetSticker();
        if (!target) {
            closeMenu();
            return;
        }

        try {
            const exportBase64 = await renderStickerComposite(target);
            const centerX = target.x + target.w / 2;
            const centerY = target.y + target.h / 2;
            await api.saveStickerImageAs(exportBase64, centerX, centerY);
        } catch (error) {
            console.error("Save sticker composite failed", error);
        } finally {
            closeMenu();
        }
    };

    const handleClearRecycleBin = () => {
        graphStore.setRecycleBin([]);
        closeMenu();
        persistSession();
    };

    const handleToggleReference = () => {
        const target = targetSticker();
        if (!target) {
            closeMenu();
            return;
        }

        if (graphStore.referenceLibrary.some((entry) => entry.sourceStickerId === target.id)) {
            graphStore.setReferenceLibrary(cancelReferenceEntry(graphStore.referenceLibrary, target.id));
        } else {
            graphStore.setReferenceLibrary(
                setReferenceEntry(graphStore.referenceLibrary, captureFrozenStickerSnapshot(target)),
            );
        }

        closeMenu();
        persistSession();
    };

    const handleClearReferenceLibrary = () => {
        graphStore.setReferenceLibrary([]);
        closeMenu();
        persistSession();
    };

    const handleRecycleRestore = (entryId: string) => {
        const result = restoreRecycleBinEntry(graphStore.recycleBin, entryId, menuMouse());

        graphStore.setRecycleBin(result.entries);
        graphStore.actions.addUnit(result.restored);
        uiActions.hideStickerToolbar();
        selectionActions.set([result.restored.id]);
        closeMenu();
        persistLayoutAndSession();
    };

    const handleRecycleDelete = (entryId: string) => {
        graphStore.setRecycleBin(removeFrozenStickerEntry(graphStore.recycleBin, entryId));
        persistSession();
    };

    const handleReferenceCopy = (entryId: string) => {
        const copied = copyReferenceEntry(graphStore.referenceLibrary, entryId, menuMouse());

        graphStore.actions.addUnit(copied);
        uiActions.hideStickerToolbar();
        selectionActions.set([copied.id]);
        closeMenu();
        persistLayoutAndSession();
    };

    const handleReferenceRemove = (entryId: string) => {
        graphStore.setReferenceLibrary(removeFrozenStickerEntry(graphStore.referenceLibrary, entryId));
        persistSession();
    };

    createEffect(() => {
        if (!stickerContextMenuController.state.isOpen) {
            return;
        }

        const handlePointerDown = (event: PointerEvent) => {
            if (menuRootRef?.contains(event.target as Node)) {
                return;
            }

            closeMenu();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") {
                return;
            }

            closeMenu();
        };

        const handleWindowBlur = () => {
            closeMenu();
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                closeMenu();
            }
        };

        document.addEventListener("pointerdown", handlePointerDown, true);
        window.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("blur", handleWindowBlur);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        onCleanup(() => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            window.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("blur", handleWindowBlur);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        });
    });

    createEffect(() => {
        if (!stickerContextMenuController.state.isOpen || !menuRootRef) {
            removeRect(CONTEXT_MENU_RECT_ID);
            void syncService.updateBackendRects();
            return;
        }

        const syncRect = () => {
            if (!menuRootRef) {
                return;
            }

            const rect = menuRootRef.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
                return;
            }

            addOrUpdateRect({
                id: CONTEXT_MENU_RECT_ID,
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height,
                name: CONTEXT_MENU_RECT_NAME,
            });
            void syncService.updateBackendRects();
        };

        requestAnimationFrame(syncRect);

        let observer: ResizeObserver | undefined;
        if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(syncRect);
            observer.observe(menuRootRef);
        }

        onCleanup(() => {
            observer?.disconnect();
            removeRect(CONTEXT_MENU_RECT_ID);
            void syncService.updateBackendRects();
        });
    });

    createEffect(() => {
        if (!stickerContextMenuController.state.isOpen) {
            return;
        }

        if (!targetSticker()) {
            closeMenu();
        }
    });

    return (
        <Portal>
            <Show when={stickerContextMenuController.state.isOpen && stickerContextMenuController.state.targetStickerId}>
                <div class="pointer-events-none fixed inset-0 z-[1400]">
                    <div
                        ref={menuRootRef}
                        class="pointer-events-auto fixed flex items-start gap-0"
                        style={{
                            left: `${stickerContextMenuController.state.mouseX}px`,
                            top: `${stickerContextMenuController.state.mouseY}px`,
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onMouseUp={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                    >
                        <StickerContextMenuPanel
                            referenceActionLabel={referenceActionLabel()}
                            onCloseSticker={handleCloseSticker}
                            onSave={() => void handleSave()}
                            onClearRecycleBin={handleClearRecycleBin}
                            onToggleReference={handleToggleReference}
                            onClearReferenceLibrary={handleClearReferenceLibrary}
                            onOpenSubmenu={(submenu, anchor) => stickerContextMenuController.openSubmenu(submenu, anchor)}
                        />
                        <Show when={stickerContextMenuController.state.activeSubmenu !== "none"}>
                            <div
                                style={{
                                    "margin-top": `${stickerContextMenuController.state.submenuOffsetY}px`,
                                }}
                            >
                                <StickerSnapshotListPanel
                                    entries={activeSubmenuEntries()}
                                    onLeftActivate={(entryId) => {
                                        if (stickerContextMenuController.state.activeSubmenu === "recycleBin") {
                                            handleRecycleRestore(entryId);
                                            return;
                                        }

                                        handleReferenceCopy(entryId);
                                    }}
                                    onRightActivate={(entryId) => {
                                        if (stickerContextMenuController.state.activeSubmenu === "recycleBin") {
                                            handleRecycleDelete(entryId);
                                            return;
                                        }

                                        handleReferenceRemove(entryId);
                                    }}
                                />
                            </div>
                        </Show>
                    </div>
                </div>
            </Show>
        </Portal>
    );
};
