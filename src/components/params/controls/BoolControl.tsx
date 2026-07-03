
import { Component, Show } from "solid-js";

interface BoolControlProps {
  id: string;
  label: string;
  value: boolean;
  widget?: "checkbox" | "switch"; // Default to checkbox if not specified? Or handle both here.
  isDisabled: boolean;
  onChange: (value: boolean) => void;
  onContextMenu: (e: MouseEvent) => void;
}

export const BoolControl: Component<BoolControlProps> = (props) => {
  return (
    <div class="flex items-center gap-3 w-full h-6">
      <label
        class="text-[#EEF1FF]/80 font-medium text-[11px] shrink-0 truncate cursor-context-menu"
        style={{ "min-width": "70px" }}
      >
        {props.label}
      </label>
      <div class="flex-1 flex justify-end">
        <label
          class="flex items-center gap-2 cursor-pointer group"
          classList={{ "pointer-events-none opacity-50": props.isDisabled }}
        >
          <span class="text-white/50 text-[10px] uppercase tracking-wider group-hover:text-white/70 transition-colors">
            {props.value ? "On" : "Off"}
          </span>
          <div
            class={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
              props.value
                ? 'bg-primary border-primary'
                : 'bg-transparent border-white-30 group-hover-border-white-50'
            }`}
            onClick={() => !props.isDisabled && props.onChange(!props.value)}
            onContextMenu={props.onContextMenu}
          >
            <Show when={props.value}>
              <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
              </svg>
            </Show>
          </div>
        </label>
      </div>
    </div>
  );
};
