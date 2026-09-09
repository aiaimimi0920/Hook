import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";

import { extensionCommandRouter } from "../services/extensionCommandRouter";
import { extensionPresentationStore } from "../services/extensionPresentationStore";
import { currentExtensionTarget } from "../services/extensionContext";
import { showUnitFailureNotice } from "../services/unitFailureNotice";

export const ExtensionCommandPalette: Component = () => {
    const [open, setOpen] = createSignal(false);
    const availableItems = createMemo(() => (
        extensionPresentationStore.paletteItems().filter((item) => item.available())
    ));
    let dialog: HTMLElement | undefined;
    let returnFocus: HTMLElement | null = null;

    createEffect(() => {
        if (open()) {
            returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            queueMicrotask(() => dialog?.focus());
        } else if (returnFocus) {
            returnFocus.focus();
            returnFocus = null;
        }
    });

    onMount(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "p") {
                const target = event.target as HTMLElement | null;
                if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
                event.preventDefault();
                setOpen((current) => !current);
            } else if (event.key === "Escape" && open()) {
                event.preventDefault();
                setOpen(false);
            }
        };
        window.addEventListener("keydown", handleKeyDown, true);
        onCleanup(() => window.removeEventListener("keydown", handleKeyDown, true));
    });

    return (
        <Show when={open()}>
            <div
                class="fixed inset-0 z-[2147483500] flex items-start justify-center bg-black/40 pt-[12vh]"
                role="presentation"
                onMouseDown={() => setOpen(false)}
            >
                <section
                    ref={dialog}
                    class="hook-terminal-shell hook-terminal-shell--strong w-[min(560px,90vw)] max-h-[70vh] overflow-y-auto p-2"
                    role="dialog"
                    aria-modal="true"
                    aria-label="扩展命令面板"
                    tabIndex={-1}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <header class="border-b border-[#414141] px-3 py-2 font-mono text-xs text-[#d9ff38]">
                        扩展命令
                    </header>
                    <For each={availableItems()} fallback={(
                        <p class="px-3 py-4 text-xs text-[#9b9b9b]">当前没有可用的扩展命令</p>
                    )}>
                        {(item) => (
                            <button
                                type="button"
                                class="block w-full border-b border-[#2c2c2c] px-3 py-2 text-left text-xs text-[#f1f1f1] hover:bg-[#2b2b2b]"
                                onClick={() => {
                                    const unitId = currentExtensionTarget()?.unitId;
                                    setOpen(false);
                                    void extensionCommandRouter.execute(item.commandId).catch(() => {
                                        showUnitFailureNotice({ feature: "Loom", title: "扩展命令执行失败",
                                            message: "命令执行失败，请检查扩展状态后重试。",
                                            source: { namespace: "core", id: "extension-command-failed" } }, unitId);
                                    });
                                }}
                            >
                                {item.title}
                            </button>
                        )}
                    </For>
                </section>
            </div>
        </Show>
    );
};
