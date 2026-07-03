import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const libSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8");
const mockArtLoomSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "mock_artloom.rs"), "utf8");

describe("Hook MCP boundary contract", () => {
  it("does not expose direct MCP server process commands from Hook", () => {
    expect(libSource).not.toContain("async fn test_mcp_connection");
    expect(libSource).not.toContain("test_mcp_connection");
    expect(libSource).not.toContain("Testing MCP Connection");
  });

  it("keeps MCP art execution routed through ArtLoom AHRP instead of local execution", () => {
    expect(mockArtLoomSource).toContain('|| et == "mcp"');
    expect(mockArtLoomSource).toContain('"method": "art/process"');
    expect(mockArtLoomSource).toContain("Connected to ArtLoom WebSocket");
  });
});
