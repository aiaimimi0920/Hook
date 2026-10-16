import { createSignal, createUniqueId, Show } from "solid-js";
import { api } from "../../../platform/tauri/api";
import { isProjectionReceivePolicy, projectionReceivePolicy, saveProjectionReceivePolicy } from "../state/projectionReceivePolicyStore";
import { createPropertyDropdownController } from "../../stickers/components/stickerTopStripPropertyDropdownController";
import "../styles/projection-settings.css";

const policies = [
    { value: "auto", label: "自动" },
    { value: "confirm", label: "手动" },
    { value: "reject", label: "拒绝" },
];

/** Every sticker panel edits the same persisted, device-wide receive consent. */
export const ProjectionReceivePolicyControl = () => {
    const [error, setError] = createSignal("");
    const id = `projection-receive-policy-${createUniqueId()}`;
    const focusOverlayWindow = () => api.focusOverlayWindow().catch(() => undefined);
    // Shield-relayed clicks cannot open a native select popup. Reuse the protected
    // portal menu, including viewport clamping, hit rectangles and disposal.
    const dropdown = createPropertyDropdownController({
        unitId: () => id, focusOverlayWindow, constrainToViewport: () => true,
    });
    const focus = (event: MouseEvent | PointerEvent) => {
        event.stopPropagation();
        (event.currentTarget as HTMLButtonElement).focus();
        void focusOverlayWindow();
    };
    const toggle = (button: HTMLButtonElement) => {
        const bounds = button.getBoundingClientRect();
        dropdown.toggleDropdownMenu(id,
            { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
            Math.max(104, bounds.width), policies, projectionReceivePolicy(), (value) => {
                try {
                    if (!isProjectionReceivePolicy(value)) return;
                    saveProjectionReceivePolicy(value); setError("");
                } catch { setError("保存接收策略失败"); }
                finally { dropdown.closeDropdownMenu(); button.focus(); }
            });
    };
    return <>
        <div class="projection-receive-policy">
            <span>接收策略</span>
            <button type="button" class="projection-receive-policy-trigger" aria-label="接收策略"
                aria-expanded={!!dropdown.openDropdownMenu()} data-top-strip-popup-trigger={id}
                on:pointerdown={focus} on:mousedown={focus}
                on:click={(event) => { event.stopPropagation(); toggle(event.currentTarget); }}
                on:contextmenu={(event) => event.stopPropagation()}
            >
                <span>{policies.find((option) => option.value === projectionReceivePolicy())?.label}</span>
                <span aria-hidden="true">▾</span>
            </button>
        </div>
        <dropdown.PropertyDropdownPortal />
        <Show when={error()}><span class="projection-settings-notice" role="alert">{error()}</span></Show>
    </>;
};
