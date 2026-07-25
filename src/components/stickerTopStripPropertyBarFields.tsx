import { Show, createMemo, type Accessor, type Component } from "solid-js";

import type { NumericToolSettingKey, ShapeColorSettingKey } from "./stickerToolbarModel";
import type { MiniIconProps } from "./stickerTopStripPropertyBarIcons";
import type { StickerToolSettings } from "../types/stickerEditing";

export interface MiniDropdownOption {
    value: string;
    label: string;
    title?: string;
}

export type MiniColorFieldComponent = Component<{
    title: string;
    slot: ShapeColorSettingKey;
    Icon: Component<MiniIconProps>;
}>;

export type MiniDirectColorFieldComponent = Component<{
    title: string;
    value: string;
    Icon: Component<MiniIconProps>;
    onOpen: (button: HTMLButtonElement) => void;
}>;

export type MiniNumericFieldComponent = Component<{
    title: string;
    settingKey: NumericToolSettingKey;
    currentValue: number;
    min: number;
    max: number;
    Icon: Component<MiniIconProps>;
    inputClass?: string;
}>;

export type MiniDeferredNumericFieldComponent = Component<{
    title: string;
    value: string;
    Icon: Component<MiniIconProps>;
    onInput: (value: string) => void;
    onCommit: () => void;
    inputClass?: string;
}>;

export type MiniToggleFieldComponent = Component<{
    title: string;
    enabled: boolean;
    onToggle: () => void;
    Icon: Component<MiniIconProps>;
}>;

export type MiniActionFieldComponent = Component<{
    title: string;
    onClick: () => void | Promise<void>;
    Icon: Component<MiniIconProps>;
}>;

export type MiniSwitchFieldComponent = Component<{
    title: string;
    enabled: boolean;
    onToggle: () => void;
    Icon: Component<MiniIconProps>;
}>;

export type MiniDropdownFieldComponent = Component<{
    id: string;
    title: string;
    value: string;
    options: MiniDropdownOption[];
    onChange: (value: string) => void;
    onOpen?: () => void;
    Icon?: Component<MiniIconProps>;
    triggerWidthClass: string;
    menuWidth: number;
    triggerLabelClass?: string;
}>;

export type MiniDashFieldComponent = Component<{
    title: string;
}>;

export type MiniFontFieldComponent = Component<{
    title: string;
    value: string;
    onChange: (value: string) => void;
}>;

export interface StickerTopStripPropertyBarFieldSet {
    MiniActionField: MiniActionFieldComponent;
    MiniColorField: MiniColorFieldComponent;
    MiniDashField: MiniDashFieldComponent;
    MiniDeferredNumericField: MiniDeferredNumericFieldComponent;
    MiniDirectColorField: MiniDirectColorFieldComponent;
    MiniDropdownField: MiniDropdownFieldComponent;
    MiniFontField: MiniFontFieldComponent;
    MiniNumericField: MiniNumericFieldComponent;
    MiniSwitchField: MiniSwitchFieldComponent;
    MiniToggleField: MiniToggleFieldComponent;
}

interface CreateStickerTopStripPropertyBarFieldsOptions {
    unitId: Accessor<string>;
    dashOptions: Array<{ key: "solid" | "dash-1" | "dash-2"; label: string; title: string }>;
    iconShellClass: string;
    groupedShellClass: string;
    compactInputClass: string;
    stickerToolSettings: StickerToolSettings;
    availableFontFamilies: Accessor<string[]>;
    fontIcon: Component<MiniIconProps>;
    focusOverlayWindow: () => Promise<void>;
    openColorPicker: (slot: ShapeColorSettingKey, button: HTMLButtonElement) => void;
    getNumericValue: (key: NumericToolSettingKey, value: number) => string;
    setNumericDraft: (key: NumericToolSettingKey, value: string) => void;
    commitNumericDraft: (key: NumericToolSettingKey, currentValue: number, min: number, max: number) => void;
    isDropdownOpen: (id: string) => boolean;
    patchStickerToolSettings: (patch: Partial<StickerToolSettings>) => void;
    toggleDropdownMenu: (
        id: string,
        anchor: { x: number; y: number; width: number; height: number },
        width: number,
        options: MiniDropdownOption[],
        value: string,
        onSelect: (value: string) => void,
    ) => void;
    closeDropdownMenu: () => void;
    loadInstalledFontsOnDemand: () => void;
}

export const createStickerTopStripPropertyBarFields = (
    options: CreateStickerTopStripPropertyBarFieldsOptions,
): StickerTopStripPropertyBarFieldSet => {
    const focusOverlayFromPointerEvent = (event: PointerEvent | MouseEvent) => {
        event.stopPropagation();
        void options.focusOverlayWindow();
    };

    const MiniColorField: MiniColorFieldComponent = (fieldProps) => {
        let buttonRef: HTMLButtonElement | undefined;
        const current = createMemo(() => options.stickerToolSettings[fieldProps.slot]);
        const isTransparent = createMemo(
            () => current().trim().toLowerCase() === "transparent" || current().trim().toLowerCase() === "#00000000",
        );

        return (
            <button
                ref={buttonRef}
                type="button"
                class={`${options.iconShellClass} relative w-6 overflow-hidden`}
                title={fieldProps.title}
                onClick={() => {
                    if (!buttonRef) return;
                    options.openColorPicker(fieldProps.slot, buttonRef);
                }}
            >
                <span
                    class="absolute inset-0"
                    style={{
                        background:
                            "linear-gradient(45deg, #9ca3af 25%, transparent 25%), linear-gradient(-45deg, #9ca3af 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #9ca3af 75%), linear-gradient(-45deg, transparent 75%, #9ca3af 75%)",
                        "background-size": "6px 6px",
                        "background-position": "0 0, 0 3px, 3px -3px, -3px 0px",
                    }}
                />
                <Show when={!isTransparent()}>
                    <span class="absolute inset-[2px]" style={{ background: current() }} />
                </Show>
                <span class="relative z-[1] text-white">
                    <fieldProps.Icon class="h-3.5 w-3.5" />
                </span>
            </button>
        );
    };

    const MiniDirectColorField: MiniDirectColorFieldComponent = (fieldProps) => {
        let buttonRef: HTMLButtonElement | undefined;
        const isTransparent = createMemo(
            () =>
                fieldProps.value.trim().toLowerCase() === "transparent"
                || fieldProps.value.trim().toLowerCase() === "#00000000",
        );

        return (
            <button
                ref={buttonRef}
                type="button"
                class={`${options.iconShellClass} relative w-6 overflow-hidden`}
                title={fieldProps.title}
                onClick={() => {
                    if (!buttonRef) return;
                    fieldProps.onOpen(buttonRef);
                }}
            >
                <span
                    class="absolute inset-0"
                    style={{
                        background:
                            "linear-gradient(45deg, #9ca3af 25%, transparent 25%), linear-gradient(-45deg, #9ca3af 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #9ca3af 75%), linear-gradient(-45deg, transparent 75%, #9ca3af 75%)",
                        "background-size": "6px 6px",
                        "background-position": "0 0, 0 3px, 3px -3px, -3px 0px",
                    }}
                />
                <Show when={!isTransparent()}>
                    <span class="absolute inset-[2px]" style={{ background: fieldProps.value }} />
                </Show>
                <span class="relative z-[1] text-white">
                    <fieldProps.Icon class="h-3.5 w-3.5" />
                </span>
            </button>
        );
    };

    const MiniNumericField: MiniNumericFieldComponent = (fieldProps) => (
        <label class={options.groupedShellClass} title={fieldProps.title}>
            <fieldProps.Icon class="h-3.5 w-3.5 shrink-0 text-white/70" />
            <input
                class={`${options.compactInputClass} ${fieldProps.inputClass ?? ""}`.trim()}
                type="text"
                inputmode="numeric"
                value={options.getNumericValue(fieldProps.settingKey, fieldProps.currentValue)}
                onInput={(event) => options.setNumericDraft(fieldProps.settingKey, event.currentTarget.value)}
                onBlur={() =>
                    options.commitNumericDraft(
                        fieldProps.settingKey,
                        fieldProps.currentValue,
                        fieldProps.min,
                        fieldProps.max,
                    )
                }
                onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    options.commitNumericDraft(
                        fieldProps.settingKey,
                        fieldProps.currentValue,
                        fieldProps.min,
                        fieldProps.max,
                    );
                    event.currentTarget.blur();
                }}
            />
        </label>
    );

    const MiniDeferredNumericField: MiniDeferredNumericFieldComponent = (fieldProps) => (
        <label class={options.groupedShellClass} title={fieldProps.title}>
            <fieldProps.Icon class="h-3.5 w-3.5 shrink-0 text-white/70" />
            <input
                class={`${options.compactInputClass} ${fieldProps.inputClass ?? ""}`.trim()}
                type="text"
                inputmode="numeric"
                value={fieldProps.value}
                onInput={(event) => fieldProps.onInput(event.currentTarget.value)}
                onBlur={() => fieldProps.onCommit()}
                onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    fieldProps.onCommit();
                    event.currentTarget.blur();
                }}
            />
        </label>
    );

    const MiniToggleField: MiniToggleFieldComponent = (fieldProps) => (
        <button
            type="button"
            class={`hook-mini-toggle ${options.iconShellClass} w-6`}
            classList={{
                "hook-mini-toggle--active": fieldProps.enabled,
                "border-white/10 bg-black/35 text-white/75 hover:border-white/25 hover:bg-white/10": !fieldProps.enabled,
            }}
            title={fieldProps.title}
            onClick={() => fieldProps.onToggle()}
        >
            <fieldProps.Icon class="h-3.5 w-3.5" />
        </button>
    );

    const MiniActionField: MiniActionFieldComponent = (fieldProps) => (
        <button
            type="button"
            class={`${options.iconShellClass} w-6`}
            title={fieldProps.title}
            onClick={() => void fieldProps.onClick()}
        >
            <fieldProps.Icon class="h-3.5 w-3.5" />
        </button>
    );

    const MiniSwitchField: MiniSwitchFieldComponent = (fieldProps) => (
        <button
            type="button"
            class="hook-mini-switch flex h-6 w-[42px] shrink-0 items-center justify-between border px-1.5 transition-colors"
            classList={{
                "hook-mini-switch--active": fieldProps.enabled,
                "border-white/10 bg-black/35 text-white/75 hover:border-white/25 hover:bg-white/10": !fieldProps.enabled,
            }}
            title={fieldProps.title}
            onClick={() => fieldProps.onToggle()}
        >
            <fieldProps.Icon class="h-3.5 w-3.5 shrink-0" />
            <span
                class="hook-mini-switch__thumb h-3.5 w-3.5 shrink-0 transition-all"
                classList={{
                    "translate-x-0": fieldProps.enabled,
                    "-translate-x-0.5": !fieldProps.enabled,
                }}
            />
        </button>
    );

    const MiniDropdownField: MiniDropdownFieldComponent = (fieldProps) => {
        let buttonRef: HTMLButtonElement | undefined;
        const selectedOption = createMemo(
            () => fieldProps.options.find((option) => option.value === fieldProps.value) ?? fieldProps.options[0],
        );
        const isOpen = createMemo(() => options.isDropdownOpen(fieldProps.id));

        return (
            <button
                ref={buttonRef}
                type="button"
                data-top-strip-popup-trigger={fieldProps.id}
                class={`${options.groupedShellClass} ${fieldProps.triggerWidthClass} justify-between`}
                title={fieldProps.title}
                onPointerDown={focusOverlayFromPointerEvent}
                onMouseDown={focusOverlayFromPointerEvent}
                onClick={() => {
                    if (!buttonRef) return;
                    fieldProps.onOpen?.();
                    const rect = buttonRef.getBoundingClientRect();
                    options.toggleDropdownMenu(
                        fieldProps.id,
                        {
                            x: rect.left,
                            y: rect.top,
                            width: rect.width,
                            height: rect.height,
                        },
                        fieldProps.menuWidth,
                        fieldProps.options,
                        fieldProps.value,
                        fieldProps.onChange,
                    );
                }}
            >
                <span class="flex min-w-0 items-center gap-1">
                    {fieldProps.Icon
                        ? (() => {
                              const Icon = fieldProps.Icon!;
                              return <Icon class="h-3.5 w-3.5 shrink-0 text-white/70" />;
                          })()
                        : null}
                    <span
                        class={`truncate text-left text-[10px] text-white ${
                            fieldProps.triggerLabelClass ?? ""
                        }`.trim()}
                    >
                        {selectedOption()?.label ?? fieldProps.value}
                    </span>
                </span>
                <span class={`shrink-0 text-[9px] text-white/55 transition-transform ${isOpen() ? "rotate-180" : ""}`}>
                    ▾
                </span>
            </button>
        );
    };

    const MiniDashField: MiniDashFieldComponent = (fieldProps) => (
        <MiniDropdownField
            id={`${options.unitId()}-dash-pattern`}
            title={fieldProps.title}
            value={options.stickerToolSettings.shapeStrokeDashPattern}
            options={options.dashOptions.map((option) => ({
                value: option.key,
                label: option.label,
                title: option.title,
            }))}
            onChange={(value) => {
                options.patchStickerToolSettings({
                    shapeStrokeDashPattern: value as "solid" | "dash-1" | "dash-2",
                });
                options.closeDropdownMenu();
            }}
            triggerWidthClass="w-[46px]"
            menuWidth={72}
            triggerLabelClass="text-center font-semibold"
        />
    );

    const MiniFontField: MiniFontFieldComponent = (fieldProps) => (
        <MiniDropdownField
            id={`${options.unitId()}-${fieldProps.title}-font`}
            title={fieldProps.title}
            value={fieldProps.value}
            options={options.availableFontFamilies().map((font) => ({
                value: font,
                label: font,
                title: font,
            }))}
            onChange={(value) => {
                fieldProps.onChange(value);
                options.closeDropdownMenu();
            }}
            onOpen={options.loadInstalledFontsOnDemand}
            Icon={options.fontIcon}
            triggerWidthClass="w-[110px]"
            menuWidth={196}
        />
    );

    return {
        MiniActionField,
        MiniColorField,
        MiniDashField,
        MiniDeferredNumericField,
        MiniDirectColorField,
        MiniDropdownField,
        MiniFontField,
        MiniNumericField,
        MiniSwitchField,
        MiniToggleField,
    };
};
