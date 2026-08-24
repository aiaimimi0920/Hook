// Routes image, shared-memory, native drag/export, and clipboard commands to their native owners.
import type { FileNamingContext } from "../types/fileNaming";
import { safeInvoke } from "./apiTransport";
import type { ScreenColorSample } from "./apiTypes";

export const imageResourceApi = {
    readSharedMemory: (handle: string, size: number, width: number, height: number): Promise<string> =>
        safeInvoke("read_shared_memory", { handle, size, width, height }),
    releaseArtSharedMemory: (
        nodeId: string,
        executionRequestId: string,
        generation: number,
        handles: string[],
    ): Promise<void> => safeInvoke(
        "release_art_shared_memory",
        { nodeId, executionRequestId, generation, handles },
        () => undefined,
        false,
    ),

    getCursorPosition: (): Promise<{ x: number; y: number }> =>
        safeInvoke("get_cursor_position", undefined, () => ({ x: 0, y: 0 }), false),
    pickScreenColorAt: (x: number, y: number): Promise<ScreenColorSample> =>
        safeInvoke("pick_screen_color_at", { x, y }, () => ({
            hex: "#000000",
            rgb: { r: 0, g: 0, b: 0 },
        }), false),
    pickScreenColorAtCursor: (): Promise<ScreenColorSample> =>
        safeInvoke("pick_screen_color_at_cursor", undefined, () => ({
            hex: "#000000",
            rgb: { r: 0, g: 0, b: 0 },
        }), false),

    readImageFromPath: (path: string): Promise<string> =>
        safeInvoke("read_image_from_path", { path }),
    cacheRemoteImageAsset: (url: string, referer?: string): Promise<string> =>
        safeInvoke("cache_remote_image_asset", { url, referer }),

    beginStickerNativeFileDrag: (
        base64: string,
        fileNamingContext?: FileNamingContext,
    ): Promise<string> =>
        safeInvoke(
            "begin_sticker_native_file_drag",
            { base64Image: base64, fileNamingContext },
            () => {
                throw new Error("Native sticker file drag requires the Tauri desktop runtime");
            },
            false,
        ),

    beginStickerNativeFileDragFromPath: (
        path: string,
        fileNamingContext?: FileNamingContext,
    ): Promise<string> =>
        safeInvoke(
            "begin_sticker_native_file_drag_from_path",
            { path, fileNamingContext },
            () => {
                throw new Error("Native sticker file drag from path requires the Tauri desktop runtime");
            },
            false,
        ),

    saveStickerDragExport: (
        base64: string,
        fileNamingContext: FileNamingContext | undefined,
        globalX: number,
        globalY: number,
    ): Promise<string> =>
        safeInvoke(
            "save_sticker_drag_export",
            { base64Image: base64, fileNamingContext, globalX, globalY },
            () => {
                throw new Error("Shift drag export requires the Tauri desktop runtime");
            },
            false,
        ),

    saveStickerDragExportFromPath: (
        path: string,
        fileNamingContext: FileNamingContext | undefined,
        globalX: number,
        globalY: number,
    ): Promise<string> =>
        safeInvoke(
            "save_sticker_drag_export_from_path",
            { path, fileNamingContext, globalX, globalY },
            () => {
                throw new Error("Shift drag export from path requires the Tauri desktop runtime");
            },
            false,
        ),

    saveStickerImage: (base64: string, fileNamingContext?: FileNamingContext): Promise<string> =>
        safeInvoke("save_sticker_image", { base64Image: base64, fileNamingContext }),
    saveStickerImageAs: (
        base64: string,
        dialogCenterX: number,
        dialogCenterY: number,
        fileNamingContext?: FileNamingContext,
    ): Promise<string | null> =>
        safeInvoke("save_sticker_image_as", {
            base64Image: base64,
            dialogCenterX,
            dialogCenterY,
            fileNamingContext,
        }),
    openImageForEdit: (): Promise<string | null> =>
        safeInvoke("open_image_for_edit", undefined, () => null, false),
    readClipboardImage: (): Promise<string | null> =>
        safeInvoke("read_clipboard_image", undefined, () => null, false),

    copyNodeImageToClipboard: (base64: string, fileNamingContext?: FileNamingContext): Promise<string> =>
        safeInvoke(
            "copy_node_image_to_clipboard",
            { base64Image: base64, fileNamingContext },
            () => "browser-preview",
            false,
        ),
    copyToClipboard: (base64: string): Promise<void> =>
        safeInvoke("copy_to_clipboard", { base64Image: base64 }, () => undefined, false),
    copyStickerImageToSmartClipboard: (base64: string, fileNamingContext?: FileNamingContext): Promise<string> =>
        safeInvoke(
            "copy_sticker_image_to_smart_clipboard",
            { base64Image: base64, fileNamingContext },
            () => "browser-preview",
            false,
        ),
};
