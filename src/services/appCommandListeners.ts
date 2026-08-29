import { listen } from "@tauri-apps/api/event";
import { untrack, type Setter } from "solid-js";

import { longCaptureSession, selectedStickerId } from "../store/uiStore";
import type { CaptureSelectionMode } from "./captureState";
import {
    notifyNativeAppFocus,
} from "./editableFocus";
import { api } from "./api";
import type { AppListenerRegistry } from "./appListenerRegistry";
import { runBackgroundTask } from "./backgroundTask";
import { logger } from "./logger";

export type VoiceStatus =
    | "idle"
    | "recording"
    | "transcribing"
    | "completed"
    | "failed"
    | "cancelled"
    | "unknown";

export type VoiceHotkeyPayload = {
    shortcut: string;
    event: unknown;
    kind: string;
    statusHint: string;
};

export type VoiceSessionPayload = {
    id: string;
    status: string;
    transcript?: string | null;
    outputText?: string | null;
    error?: string | null;
    sessionLogPath?: string | null;
};

type AppCommandListenerDependencies = {
    registry: AppListenerRegistry;
    beginCaptureSelection: (mode: CaptureSelectionMode) => Promise<void>;
    finishAutoLongCaptureSession: () => Promise<boolean>;
    notifyAutoLongCaptureWheel: (delta: { deltaX: number; deltaY: number }) => void;
    toggleStickerToolbarVisibility: () => void;
    openImageForEdit: () => Promise<void>;
    setAppSettingsOpen: Setter<boolean>;
    handleCopy: () => void;
    handlePaste: () => void;
    createTeaTicketFromCurrentHookState: () => Promise<void>;
    setLastVoiceHotkey: Setter<VoiceHotkeyPayload | null>;
    setLastVoiceSession: Setter<VoiceSessionPayload | null>;
    setVoiceStatus: Setter<VoiceStatus>;
    handleEscape: () => void;
    handleDelete: () => void;
};

const resolveVoiceHotkeyStatus = (payload: VoiceHotkeyPayload): VoiceStatus => {
    switch (payload.statusHint) {
        case "recording":
        case "transcribing":
        case "cancelled":
            return payload.statusHint;
        default:
            return "unknown";
    }
};

const resolveVoiceSessionStatus = (payload: VoiceSessionPayload): VoiceStatus => {
    switch (payload.status) {
        case "recording":
        case "transcribing":
        case "completed":
        case "failed":
        case "cancelled":
            return payload.status;
        default:
            return "unknown";
    }
};

/** Registers desktop command listeners while App retains product action ownership. */
export async function registerAppCommandListeners({
    registry,
    beginCaptureSelection,
    finishAutoLongCaptureSession,
    notifyAutoLongCaptureWheel,
    toggleStickerToolbarVisibility,
    openImageForEdit,
    setAppSettingsOpen,
    handleCopy,
    handlePaste,
    createTeaTicketFromCurrentHookState,
    setLastVoiceHotkey,
    setLastVoiceSession,
    setVoiceStatus,
    handleEscape,
    handleDelete,
}: AppCommandListenerDependencies): Promise<void> {
    await registry.register(() => listen("trigger-capture", () => {
        logger.debug("Backend Triggered Capture Mode");
        void api.debugLogEvent("trigger-capture-listener");
        setAppSettingsOpen(false);
        runBackgroundTask("region capture activation", beginCaptureSelection("region"));
    }));

    await registry.register(() => listen("trigger-long-capture", () => {
        logger.debug("Backend Triggered Long Capture Mode");
        void api.debugLogEvent("trigger-long-capture-listener");
        setAppSettingsOpen(false);
        if (longCaptureSession()?.active) {
            runBackgroundTask("long capture finish", finishAutoLongCaptureSession());
            return;
        }
        runBackgroundTask("long capture activation", beginCaptureSelection("long-vertical"));
    }));

    await registry.register(() => listen("trigger-long-capture-finish", () => {
        void api.debugLogEvent("trigger-long-capture-finish-listener");
        if (longCaptureSession()?.active) {
            runBackgroundTask("long capture finish", finishAutoLongCaptureSession());
        }
    }));

    await registry.register(() => listen<{ deltaX?: number; deltaY?: number }>(
        "trigger-long-capture-wheel",
        (event) => {
            if (!longCaptureSession()?.active) return;
            notifyAutoLongCaptureWheel({
                deltaX: event.payload?.deltaX ?? 0,
                deltaY: event.payload?.deltaY ?? 0,
            });
        },
    ));

    await registry.register(() => listen("trigger-toggle-sticker-toolbar", () => {
        logger.debug("Backend Triggered Sticker Toolbar Toggle");
        void api.debugLogEvent("trigger-toggle-sticker-toolbar-listener");
        toggleStickerToolbarVisibility();
    }));

    await registry.register(() => listen("trigger-open-image", () => {
        void api.debugLogEvent("trigger-open-image-listener");
        runBackgroundTask("open image editor", openImageForEdit());
    }));

    await registry.register(() => listen("trigger-open-app-settings", () => {
        void api.debugLogEvent("trigger-open-app-settings-listener");
        setAppSettingsOpen(true);
    }));

    await registry.register(() => listen("trigger-copy", () => {
        void api.debugLogEvent("trigger-copy-listener");
        if (!selectedStickerId()) return;
        void handleCopy();
    }));

    await registry.register(() => listen("trigger-paste", () => {
        void api.debugLogEvent("trigger-paste-listener");
        if (!selectedStickerId()) return;
        void handlePaste();
    }));

    await registry.register(() => listen<{
        key: string;
        ctrlKey: boolean;
        shiftKey: boolean;
        altKey: boolean;
        metaKey: boolean;
    }>("overlay/global_shortcut", (event) => {
        const payload = event.payload;
        if (!payload?.key) return;
        window.dispatchEvent(new KeyboardEvent("keydown", {
            key: payload.key,
            ctrlKey: !!payload.ctrlKey,
            shiftKey: !!payload.shiftKey,
            altKey: !!payload.altKey,
            metaKey: !!payload.metaKey,
            bubbles: true,
            cancelable: true,
        }));
    }));

    await registry.register(() => listen<boolean>("hook/window_focus_changed", (event) => {
        notifyNativeAppFocus(event.payload);
    }));

    await registry.register(() => listen("trigger-create-tea-ticket", () => {
        untrack(() => {
            logger.debug("Backend Triggered Tea Ticket Creation");
            void api.debugLogEvent("trigger-create-tea-ticket-listener");
            runBackgroundTask("Tea ticket creation", createTeaTicketFromCurrentHookState());
        });
    }));

    await registry.register(() => listen<VoiceHotkeyPayload>("voice-hotkey-event", (event) => {
        setLastVoiceHotkey(event.payload);
        setVoiceStatus(resolveVoiceHotkeyStatus(event.payload));
        void api.debugLogEvent(
            "voice-hotkey-listener",
            `kind=${event.payload.kind} status=${event.payload.statusHint}`,
        );
    }));

    await registry.register(() => listen<VoiceSessionPayload>("voice-session-event", (event) => {
        setLastVoiceSession(event.payload);
        setVoiceStatus(resolveVoiceSessionStatus(event.payload));
        void api.debugLogEvent(
            "voice-session-listener",
            `id=${event.payload.id} status=${event.payload.status}`,
        );
    }));

    await registry.register(() => listen("trigger-escape", handleEscape));
    await registry.register(() => listen("trigger-delete", handleDelete));
}
