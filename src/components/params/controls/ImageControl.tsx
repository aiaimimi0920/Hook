
import { Component, Show } from "solid-js";

interface ImageControlProps {
  id: string;
  label?: string; // Optional for file widget
  value: string | undefined; // URL or Data URI
  widget?: "file" | "image_link";
  isDisabled: boolean;
  onChange: (value: string, filename?: string) => void;
  onLinkStart?: (x: number, y: number) => void;
  onLinkDrop?: () => void;
  onLinkMove?: (e: MouseEvent) => void;
  onLinkHover?: (targetId: string | null) => void;
  onPreview?: (active: boolean) => void;
  isLinked?: boolean;
  onContextMenu: (e: MouseEvent) => void;
}

export const ImageControl: Component<ImageControlProps> = (props) => {
  const isLinked = () => props.isLinked || (props.value && !props.value.startsWith("data:"));
  const isData = () => props.value && props.value.startsWith("data:");

  return (
    <div class="flex items-center gap-3 w-full h-6">
      <Show when={props.label}>
        <label
          class="text-[var(--theme-text-secondary)] font-medium text-[11px] shrink-0 truncate cursor-context-menu"
          style={{ "min-width": "70px" }}
        >
          {props.label}
        </label>
      </Show>

      <div class="flex-1 flex gap-2 min-w-0">
        <Show when={props.widget === "image_link"}>
             <button
               class={`hook-terminal-btn w-[60%] flex items-center justify-center gap-1 h-6 px-1 text-[10px] transition-all cursor-crosshair active:scale-95 ${
                 isLinked()
                   ? "hook-terminal-btn--active"
                   : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
               }`}
               disabled={props.isDisabled}
               onMouseDown={(e) => {
                   if (e.button === 0 && !props.isDisabled) {
                       e.stopPropagation();
                       e.preventDefault();
                       props.onLinkMove?.(e);
                   }
               }}
               onMouseUp={(e) => {
                   if (props.isDisabled) return;
                   e.stopPropagation();
                   e.preventDefault();
                   props.onLinkDrop?.();
               }}
               onContextMenu={props.onContextMenu}
               onMouseEnter={() => { if (isLinked()) props.onLinkHover?.(props.value || null); }}
               onMouseLeave={() => props.onLinkHover?.(null)}
             >
                 <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
                 <span class="truncate">{isLinked() ? "Linked" : "Link"}</span>
             </button>
        </Show>

        <label
          class={`hook-terminal-btn flex-1 flex items-center justify-center gap-1.5 h-6 px-2 transition-all cursor-pointer relative group ${
            isData()
              ? "hook-terminal-btn--success text-emerald-100 hover:bg-emerald-500/30"
              : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
          }`}
          classList={{ "pointer-events-none opacity-50": props.isDisabled }}
          onMouseEnter={() => props.onPreview?.(true)}
          onMouseLeave={() => props.onPreview?.(false)}
          onContextMenu={props.onContextMenu}
        >
            <input
              type="file"
              class="hidden"
              style={{ "display": "none" }}
              accept={props.id.includes("image") ? "image/*" : "*/*"}
              disabled={props.isDisabled}
              onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) {
                      const reader = new FileReader();
                      reader.onload = (evt) => { if (evt.target?.result) props.onChange(evt.target.result as string, file.name); };
                      reader.readAsDataURL(file);
                  }
                  e.currentTarget.value = "";
              }}
            />

            <Show when={isData()} fallback={
                <>
                <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                <span class="truncate text-[10px]">{props.value ? "Selected" : "Choose File"}</span>
                </>
            }>
                <div class="w-4 h-4 bg-cover bg-center mr-0.5 border border-white/20 shrink-0" style={{ "background-image": `url(${props.value})` }}></div>
                <span class="truncate text-[9px]">Img</span>
            </Show>
        </label>
      </div>
    </div>
  );
};
