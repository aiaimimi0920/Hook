import { Show, createEffect, createMemo, onCleanup, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import { api } from "../services/api";
import { renderStickerComposite } from "../services/stickerExport";
import { buildUnitFileNamingContext } from "../services/fileNaming";
import { commitLiveCaptureUnitFrame } from "../services/liveCaptureUnit";
import { runWithLiveCaptureSnapshots } from "../services/liveCaptureSnapshotAction";
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
import { acceptsSurfaceRelayedKeydown } from "../services/surfaceHostKeydown";
import { syncService } from "../services/syncService";
import { graphStore } from "../store/graphStore";
import { selectionActions, uiActions } from "../store/uiStore";
import { StickerContextMenuPanel } from "./StickerContextMenuPanel";
import { StickerSnapshotListPanel } from "./StickerSnapshotListPanel";
import { StickerClipboardHistoryPanel } from "./StickerClipboardHistoryPanel";
import { createStickerContextMenuLayout } from "./stickerContextMenuLayout";

export const StickerContextMenuLayer = () => {
    let menuRootRef: HTMLDivElement | undefined;
    let submenuRef: HTMLDivElement | undefined;
    createStickerContextMenuLayout(() => menuRootRef, () => submenuRef);

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
            return "收藏";
        }

        return graphStore.referenceLibrary.some((entry) => entry.sourceStickerId === target.id)
            ? "取消收藏"
            : "收藏";
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

        return runWithLiveCaptureSnapshots([target.id], () => untrack(() => {
            const current = targetSticker();
            if (!stickerContextMenuController.state.isOpen || current?.id !== target.id) return;
            graphStore.setRecycleBin(addRecycleBinEntry(graphStore.recycleBin, captureFrozenStickerSnapshot(current)));
            graphStore.actions.removeUnit(target.id);
            uiActions.clearStickerHistory(target.id);
            uiActions.clearUnitUiState(target.id);
            uiActions.dismissEnhancementNotice(target.id);
            selectionActions.clear();
            uiActions.hideStickerToolbar();
            closeMenu();
            persistLayoutAndSession();
        }));
    };

    const handleSave = async () => {
        const target = targetSticker();
        if (!target) {
            closeMenu();
            return;
        }

        try {
            commitLiveCaptureUnitFrame(target.id);
            const exportBase64 = await renderStickerComposite(target);
            const centerX = target.x + target.w / 2;
            const centerY = target.y + target.h / 2;
            await api.saveStickerImageAs(
                exportBase64,
                centerX,
                centerY,
                buildUnitFileNamingContext(target),
            );
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
            closeMenu();
            persistSession();
            return;
        }
        return runWithLiveCaptureSnapshots([target.id], () => untrack(() => {
            const current = targetSticker();
            if (!stickerContextMenuController.state.isOpen || current?.id !== target.id) return;
            graphStore.setReferenceLibrary(
                setReferenceEntry(graphStore.referenceLibrary, captureFrozenStickerSnapshot(current)),
            );
            closeMenu();
            persistSession();
        }));
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
            // Opted in: dismissing an open sticker menu is the behavior the surface
            // bootstrap preserves an otherwise unused Escape for, and closing a menu is
            // not a destructive action.
            if (!acceptsSurfaceRelayedKeydown(event, { surfaceRelayed: true })) return;
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
                        ref={(el) => { menuRootRef = el; }}
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
                                ref={(el) => { submenuRef = el; }}
                                class="absolute"
                                data-sticker-context-submenu
                            >
                                <Show when={stickerContextMenuController.state.activeSubmenu === "clipboard"} fallback={<StickerSnapshotListPanel
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
                                />}>
                                    <StickerClipboardHistoryPanel unitId={stickerContextMenuController.state.targetStickerId!} onDone={closeMenu} />
                                </Show>
                            </div>
                        </Show>
                    </div>
                </div>
            </Show>
        </Portal>
    );
};
