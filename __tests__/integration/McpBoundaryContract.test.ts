import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLoomHookRustSources } from "../helpers/loomHookRustSources";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Hook MCP boundary contract", () => {
  it("does not expose direct MCP server processes from Hook", () => {
    const libSource = source("src-tauri/src/lib.rs");
    expect(libSource).not.toContain("async fn test_mcp_connection");
    expect(libSource).not.toContain("test_mcp_connection");
    expect(libSource).not.toContain("Testing MCP Connection");
  });

  it("routes every package Art, including MCP Arts, through loom.hook.art.execute", () => {
    const hookSource = readLoomHookRustSources();
    expect(hookSource).toContain('"method": "loom.hook.art.execute"');
    expect(hookSource).not.toContain('"method": "art/process"');
    expect(hookSource).not.toContain("effective_execution_type");
    expect(hookSource).not.toContain("test_mcp_connection");
  });
});
