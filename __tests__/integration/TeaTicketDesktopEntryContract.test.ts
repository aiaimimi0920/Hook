import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");
const apiSource = readFileSync(resolve(process.cwd(), "src", "services", "api.ts"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8");

describe("Hook Tea ticket desktop entry contract", () => {
  it("exposes a Tauri API wrapper for Tea ticket creation", () => {
    expect(apiSource).toContain("createTeaTicket");
    expect(apiSource).toContain('"create_tea_ticket"');
    expect(apiSource).toContain("Tea ticket creation requires the Tauri desktop runtime");
  });

  it("does not expose canvas or Tea ticket actions in the system tray menu", () => {
    expect(rustSource).not.toContain('MenuItem::with_id(app, "open_canvas"');
    expect(rustSource).not.toContain('"打开画布"');
    expect(rustSource).not.toContain('MenuItem::with_id(app, "create_tea_ticket"');
    expect(rustSource).not.toContain('"创建Tea工单"');
    expect(rustSource).not.toMatch(/"open_canvas"\s*=>/);
    expect(rustSource).not.toMatch(/"create_tea_ticket"\s*=>/);
  });

  it("listens for the tray event and submits the current Hook context to Tea", () => {
    expect(appSource).toContain('"trigger-create-tea-ticket"');
    expect(appSource).toContain("createTeaTicketFromCurrentHookState");
    expect(appSource).toContain("api.createTeaTicket");
    expect(appSource).toContain("graphStore.units.length");
    expect(appSource).toContain("lastVoiceSession()?.outputText");
  });

  it("keeps stable non-visual automation anchors for Tea ticket smoke coverage", () => {
    expect(appSource).toContain('data-testid="hook-tea-automation-surface"');
    expect(appSource).toContain("hidden aria-hidden=\"true\"");
    expect(appSource).toContain('data-testid="tea-ticket-output"');
    expect(appSource).toContain('data-testid="tea-ticket-button"');
    expect(appSource).toContain('onClick={() => void createTeaTicketFromCurrentHookState("automation")}');
    expect(appSource).toContain('{lastTeaTicket()?.id || lastTeaTicketError() || ""}');
    expect(appSource).not.toContain('data-testid="voice-status-panel"');
    expect(appSource).not.toContain('Tea Ticket: {lastTeaTicket()?.id || lastTeaTicketError() || "not submitted"}');
  });
});
