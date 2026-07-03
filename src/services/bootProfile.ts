export type StartupMode = "silent" | "visible";
export type InitialUiMode = "overlay" | "tray" | "canvas";

export interface BootProfile {
  startupMode: StartupMode;
  initialUiMode: InitialUiMode;
  autoStartCapture: boolean;
  artLoomEnabled: boolean;
  artLoomWsUrl: string;
}

export const defaultBootProfile: BootProfile = {
  startupMode: "silent",
  initialUiMode: "overlay",
  autoStartCapture: false,
  artLoomEnabled: false,
  artLoomWsUrl: "ws://127.0.0.1:19820",
};

const normalizeStartupMode = (value: unknown): StartupMode =>
  value === "visible" ? "visible" : "silent";

const normalizeInitialUiMode = (value: unknown): InitialUiMode =>
  value === "canvas" || value === "tray" || value === "overlay"
    ? value
    : "overlay";

const normalizeArtLoomWsUrl = (value: unknown): string =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : defaultBootProfile.artLoomWsUrl;

export const normalizeBootProfile = (
  value: Partial<BootProfile> | null | undefined,
): BootProfile => ({
  startupMode: normalizeStartupMode(value?.startupMode),
  initialUiMode: normalizeInitialUiMode(value?.initialUiMode),
  autoStartCapture:
    typeof value?.autoStartCapture === "boolean"
      ? value.autoStartCapture
      : defaultBootProfile.autoStartCapture,
  artLoomEnabled:
    typeof value?.artLoomEnabled === "boolean"
      ? value.artLoomEnabled
      : defaultBootProfile.artLoomEnabled,
  artLoomWsUrl: normalizeArtLoomWsUrl(value?.artLoomWsUrl),
});
