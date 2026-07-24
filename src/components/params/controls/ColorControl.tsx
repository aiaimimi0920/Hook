
import { Component, Show } from "solid-js";

interface ColorControlProps {
  id: string;
  label: string;
  value: string; // Hex or empty
  default?: string;
  isDisabled: boolean;
  onChange: (value: string) => void;
  onContextMenu: (e: MouseEvent) => void;
}

export const ColorControl: Component<ColorControlProps> = (props) => {
  return (
    <div class="flex items-center gap-3 w-full h-6">
      <label
        class="text-[#EEF1FF]/80 font-medium text-[11px] shrink-0 truncate cursor-context-menu"
        style={{ "min-width": "70px" }}
      >
        {props.label}
      </label>
      <div class="flex items-center gap-2 flex-1 justify-end">
        <span class="text-white/70 text-[10px] font-mono uppercase tracking-wider">
          {props.value || "transparent"}
        </span>
        <div
          class="relative w-6 h-6 rounded-full overflow-hidden border border-white-20 transition-colors group cursor-pointer"
          onContextMenu={(event) => props.onContextMenu(event)}
        >
          <Show when={!props.value}>
            <div class="absolute inset-0 flex items-center justify-center bg-zinc-800">
              <div class="absolute h-0.5 w-full rotate-45 bg-red-500/60" />
            </div>
          </Show>
          <input
            type="color"
            class="absolute-center p-0 m-0 cursor-pointer border-none bg-transparent"
            style={{ "width": "150%", "height": "150%", "opacity": props.value ? 1 : 0.3 }}
            value={props.value || "#000000"}
            onChange={(e) => props.onChange(e.currentTarget.value)}
            disabled={props.isDisabled}
          />
        </div>
      </div>
    </div>
  );
};
