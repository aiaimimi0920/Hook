
import { Component, Show, createEffect, createSignal } from "solid-js";
import { api } from "../../../services/api";

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

  const stopInteractiveEvent = (event: Event) => {
    event.stopPropagation();
  };

  const focusEditableTarget = (
    event: MouseEvent & { currentTarget: HTMLInputElement }
      | PointerEvent & { currentTarget: HTMLInputElement },
  ) => {
    stopInteractiveEvent(event);
    if (!props.isDisabled) {
      const target = event.currentTarget;
      target.focus();
      void api.focusOverlayWindow().finally(() => {
        requestAnimationFrame(() => target.focus());
      });
    }
  };

  return (
    <div class="flex items-center gap-3 w-full h-6">
      <label
        class="hook-param-label font-medium text-[11px] shrink-0 truncate cursor-context-menu"
        style={{ "min-width": "70px" }}
      >
        {props.label}
      </label>
      <div class="flex-1 min-w-0 overflow-hidden">
        <Show when={props.multiline} fallback={
          <input
            type="text"
            class="hook-param-control w-full border rounded px-2 py-1 text-[11px] focus:outline-none transition-colors"
            value={draftValue()}
            placeholder="Enter text..."
            disabled={props.isDisabled}
            onInput={(e) => {
              setIsEditing(true);
              const next = e.currentTarget.value;
              setDraftValue(next);
              props.onChange(next, false);
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
            onPointerDown={focusEditableTarget}
            onMouseDown={focusEditableTarget}
            onClick={stopInteractiveEvent}
            onContextMenu={(event) => {
              stopInteractiveEvent(event);
              props.onContextMenu(event);
            }}
          />
        }>
          <div
            class="hook-param-control w-full h-6 border rounded px-2 flex items-center text-[11px] transition-colors cursor-pointer group/text"
            classList={{ "pointer-events-none opacity-50": props.isDisabled }}
            onMouseDown={stopInteractiveEvent}
            onPointerDown={stopInteractiveEvent}
            onClick={(event) => {
              stopInteractiveEvent(event);
              !props.isDisabled && props.onEditStart?.();
            }}
            onContextMenu={(event) => {
              stopInteractiveEvent(event);
              props.onContextMenu(event);
            }}
          >
            <span class="truncate flex-1 min-w-0">{props.value}</span>
            <svg class="hook-param-editor-icon w-3 h-3 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
            </svg>
          </div>
        </Show>
      </div>
    </div>
  );
};
