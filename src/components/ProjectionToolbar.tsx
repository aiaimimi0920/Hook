import { Show } from "solid-js";

export type ProjectionDirection = "send" | "receive";
export type ProjectionIconKind = ProjectionDirection | "qr" | "link" | "devices" | "groups" | "friends" | "flow" | "flow-two" | "source";
export const ProjectionIcon = (props: { kind: ProjectionIconKind; class?: string }) => <svg
    class={props.class ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <Show when={props.kind === "send"}><path d="M4 12h15m-6-6 6 6-6 6M4 5v14" /></Show>
    <Show when={props.kind === "receive"}><path d="M20 12H5m6-6-6 6 6 6M20 5v14" /></Show>
    <Show when={props.kind === "flow"}><path d="M3 12h18m-5-5 5 5-5 5" /></Show>
    <Show when={props.kind === "flow-two"}><path d="M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4" /></Show>
    <Show when={props.kind === "qr"}><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3z" /><path stroke-width="3" d="M6 6h0m12 0h0M6 18h0" /><path d="M14 14h3v3h4m-7 0v4h3m4-7v-2m0 9v-1" /></Show>
    <Show when={props.kind === "link"}><path d="m9 15 6-6m-6 0 2-2a4 4 0 0 1 6 6l-2 2m0 0-2 2a4 4 0 0 1-6-6l2-2" /></Show>
    <Show when={props.kind === "devices" || props.kind === "source"}><path d="M3 4h18v12H3zM8 21h8m-4-5v5" /></Show>
    <Show when={props.kind === "groups"}><path d="M8 3h8v6H8zM2 16h8v6H2zM14 16h8v6h-8zM12 9v4M6 16v-3h12v3" /></Show>
    <Show when={props.kind === "friends"}><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 2 4v3" /></Show>
</svg>;
