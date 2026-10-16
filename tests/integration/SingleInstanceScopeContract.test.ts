import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("single instance scope contract", () => {
  it("uses one app-wide mutex name instead of hashing the current executable path, so test builds from different release folders cannot run concurrent global mouse hooks", () => {
    const source = readSource("src-tauri/src/single_instance.rs");

    expect(source).toContain('pub(crate) const HOOK_SINGLE_INSTANCE_NAME: &str = "Local\\\\ArtNexus.Hook.SingleInstance";');
    expect(source).not.toContain("std::env::current_exe()");
    expect(source).not.toContain("DefaultHasher");
    expect(source).not.toContain("hasher.finish()");
    expect(source).toContain("pub(crate) fn single_instance_name() -> String {");
    expect(source).toContain("HOOK_SINGLE_INSTANCE_NAME.to_string()");
  });
});
