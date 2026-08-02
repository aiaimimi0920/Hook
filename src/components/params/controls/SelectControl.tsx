import { Component, For } from "solid-js";
import { api } from "../../../services/api";
import type { ArtParamOption } from "../../../services/protocol";

interface SelectControlProps {
  id: string;
  label: string;
  value: unknown;
  options: ArtParamOption[];
  isDisabled: boolean;
  onChange: (value: ArtParamOption["value"]) => void;
  onContextMenu: (event: MouseEvent) => void;
}

const optionKey = (value: ArtParamOption["value"]) => `${typeof value}:${String(value)}`;

export const SelectControl: Component<SelectControlProps> = (props) => {
  const currentKey = () => {
    const selected = props.options.find((option) => Object.is(option.value, props.value));
    return selected ? optionKey(selected.value) : "";
  };

  const stopInteractiveEvent = (event: Event) => {
    event.stopPropagation();
  };

  const focusSelect = (
    event:
      | (MouseEvent & { currentTarget: HTMLSelectElement })
      | (PointerEvent & { currentTarget: HTMLSelectElement }),
  ) => {
    stopInteractiveEvent(event);
    if (props.isDisabled) return;
    const target = event.currentTarget;
    target.focus();
    void api.focusOverlayWindow().finally(() => {
      requestAnimationFrame(() => target.focus());
    });
  };

  return (
    <div class="flex items-center gap-3 w-full h-6">
      <label
        class="text-[#EEF1FF]/80 font-medium text-[11px] shrink-0 truncate cursor-context-menu"
        style={{ "min-width": "70px" }}
      >
        {props.label}
      </label>
      <select
        id={props.id}
        class="flex-1 min-w-0 h-6 bg-white/5 border border-white/10 rounded px-2 text-white/90 text-[11px] focus:outline-none hover:bg-white/10 transition-colors"
        value={currentKey()}
        disabled={props.isDisabled}
        onChange={(event) => {
          const option = props.options.find(
            (candidate) => optionKey(candidate.value) === event.currentTarget.value,
          );
          if (option) props.onChange(option.value);
        }}
        onPointerDown={focusSelect}
        onMouseDown={focusSelect}
        onClick={stopInteractiveEvent}
        onContextMenu={(event) => {
          stopInteractiveEvent(event);
          props.onContextMenu(event);
        }}
      >
        <For each={props.options}>
          {(option) => (
            <option value={optionKey(option.value)}>{option.label}</option>
          )}
        </For>
      </select>
    </div>
  );
};
