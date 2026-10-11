import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLoomOtterRustSources } from "../helpers/loomOtterRustSources";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Otter MCP boundary contract", () => {
  it("does not expose direct MCP server processes from Otter", () => {
    const libSource = source("src-tauri/src/lib.rs");
    expect(libSource).not.toContain("async fn test_mcp_connection");
    expect(libSource).not.toContain("test_mcp_connection");
    expect(libSource).not.toContain("Testing MCP Connection");
  });

  it("routes every package Art, including MCP Arts, through loom.hook.art.execute", () => {
    const otterSource = readLoomOtterRustSources();
    expect(otterSource).toContain('"method": "loom.hook.art.execute"');
    expect(otterSource).not.toContain('"method": "art/process"');
    expect(otterSource).not.toContain("effective_execution_type");
    expect(otterSource).not.toContain("test_mcp_connection");
  });
});
