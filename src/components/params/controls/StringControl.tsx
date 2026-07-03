
import { Component, Show, createEffect, createSignal } from "solid-js";

interface StringControlProps {
  id: string;
  label: string;
  value: string;
  multiline?: boolean;
  isDisabled: boolean;
  onChange: (value: string, isFinal: boolean) => void;
  onEditStart?: () => void; // For popup editor
  onContextMenu: (e: MouseEvent) => void;
}

export const StringControl: Component<StringControlProps> = (props) => {
  const [draftValue, setDraftValue] = createSignal("");
  const [isEditing, setIsEditing] = createSignal(false);

  createEffect(() => {
    if (!isEditing()) {
      setDraftValue(props.value || "");
    }
  });

  const commitDraft = () => {
    if (props.isDisabled) return;

    const next = draftValue();
    setIsEditing(false);
    props.onChange(next, true);
  };

  return (
    <div class="flex items-center gap-3 w-full h-6">
      <label
        class="text-[#EEF1FF]/80 font-medium text-[11px] shrink-0 truncate cursor-context-menu"
        style={{ "min-width": "70px" }}
      >
        {props.label}
      </label>
      <div class="flex-1 min-w-0 overflow-hidden">
        <Show when={props.multiline} fallback={
          <input
            type="text"
            class="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white/90 text-[11px] placeholder-white/20 focus:outline-none hover:bg-white/10 transition-colors"
            value={draftValue()}
            placeholder="Enter text..."
            disabled={props.isDisabled}
            onInput={(e) => {
              setIsEditing(true);
              setDraftValue(e.currentTarget.value);
              props.onChange(e.currentTarget.value, false);
            }}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDraft();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setIsEditing(false);
                setDraftValue(props.value || "");
              }
            }}
            onContextMenu={props.onContextMenu}
          />
        }>
          <div
            class="w-full h-6 bg-white/5 border border-white/10 rounded px-2 flex items-center text-white/90 text-[11px] hover:bg-white/10 transition-colors cursor-pointer group/text"
            classList={{ "pointer-events-none opacity-50": props.isDisabled }}
            onClick={() => !props.isDisabled && props.onEditStart?.()}
            onContextMenu={props.onContextMenu}
          >
            <span class="truncate flex-1 min-w-0">{props.value}</span>
            <svg class="w-3 h-3 text-white/30 group-hover/text:text-white/70 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
            </svg>
          </div>
        </Show>
      </div>
    </div>
  );
};
