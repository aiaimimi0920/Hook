import { Show } from "solid-js";

type Kind = "send" | "receive" | "import" | "export" | "source" | "copy" | "unlink" | "flow";
export const ProjectionSettingsIcon = (props: { kind: Kind }) => <svg viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <Show when={props.kind === "send" || props.kind === "receive"}>
        <path d="M4 16H2V3h20v13h-2M8 21h8" />
        <path d={props.kind === "send" ? "m6 19 6-7 6 7Z" : "m6 12 6 7 6-7Z"} />
    </Show>
    <Show when={props.kind === "import" || props.kind === "export"}>
        <path d="M7 17H6a4 4 0 0 1-.7-7.94A6.5 6.5 0 0 1 18 8a4.5 4.5 0 0 1 .5 9H17" />
        <path d={props.kind === "import" ? "M12 11v11m-3-3 3 3 3-3" : "M12 22V11m-3 3 3-3 3 3"} />
    </Show>
    <Show when={props.kind === "source"}><path d="M3 5h11l7 7-7 7H3Z" /><circle cx="7" cy="12" r="1" /></Show>
    <Show when={props.kind === "copy"}><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></Show>
    <Show when={props.kind === "unlink"}><path d="m8 14-2 2a3 3 0 0 0 4 4l2-2m4-8 2-2a3 3 0 0 0-4-4l-2 2M9 3v3M3 9h3m12 6h3m-6 3v3M9 15l6-6" /></Show>
    <Show when={props.kind === "flow"}><path d="M3 7h14m-3-3 3 3-3 3M21 17H7m3-3-3 3 3 3" /><circle cx="4" cy="17" r="1" /><circle cx="20" cy="7" r="1" /></Show>
</svg>;
