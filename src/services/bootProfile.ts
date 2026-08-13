export type StartupMode = "silent" | "visible";
export type InitialUiMode = "overlay" | "tray" | "canvas";

export interface BootProfile {
  startupMode: StartupMode;
  initialUiMode: InitialUiMode;
  autoStartCapture: boolean;
  loomHookEnabled: boolean;
  loomHookWsUrl: string;
  nativeAcceptance: boolean;
}

export const defaultBootProfile: BootProfile = {
  startupMode: "silent",
  initialUiMode: "overlay",
  autoStartCapture: false,
  loomHookEnabled: false,
  loomHookWsUrl: "ws://127.0.0.1:19820",
  nativeAcceptance: false,
};

const normalizeStartupMode = (value: unknown): StartupMode =>
  value === "visible" ? "visible" : "silent";

const normalizeInitialUiMode = (value: unknown): InitialUiMode =>
  value === "canvas" || value === "tray" || value === "overlay"
    ? value
    : "overlay";

const normalizeLoomHookWsUrl = (value: unknown): string =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : defaultBootProfile.loomHookWsUrl;

export const normalizeBootProfile = (
  value: Partial<BootProfile> | null | undefined,
): BootProfile => ({
  startupMode: normalizeStartupMode(value?.startupMode),
  initialUiMode: normalizeInitialUiMode(value?.initialUiMode),
  autoStartCapture:
    typeof value?.autoStartCapture === "boolean"
      ? value.autoStartCapture
      : defaultBootProfile.autoStartCapture,
  loomHookEnabled:
    typeof value?.loomHookEnabled === "boolean"
      ? value.loomHookEnabled
      : defaultBootProfile.loomHookEnabled,
  loomHookWsUrl: normalizeLoomHookWsUrl(value?.loomHookWsUrl),
  nativeAcceptance:
    typeof value?.nativeAcceptance === "boolean"
      ? value.nativeAcceptance
      : defaultBootProfile.nativeAcceptance,
});
