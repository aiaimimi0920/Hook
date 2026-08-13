import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Art input transport contract", () => {
  it("uses negotiated shared memory for large local inputs while retaining inline-resource fallback", () => {
    const bridge = readSource("src-tauri/src/loom_hook.rs");

    expect(bridge).toContain("SHARED_MEMORY_ART_INPUT_MIN_BYTES");
    expect(bridge).toContain("fn prepare_hook_input(");
    expect(bridge).toContain('"kind": "shared_memory"');
    expect(bridge).toContain("shmem_guard: Some(SafeShmem(shmem))");
    expect(bridge).toContain("prepare_inline_hook_input(image)");
    expect(bridge).toContain('"kind": "inline_resource"');
    expect(bridge).not.toContain('"HOOK_ART_INPUT_TRANSPORT"');
    expect(bridge).not.toContain('"shm"');
    expect(bridge).not.toContain('"input_type=base64 has_reference_input_image=');
  });

  it("binds the transport choice to the negotiated local session", () => {
    const bridge = readSource("src-tauri/src/loom_hook.rs");

    expect(bridge).toContain("negotiated_transport: TransportMode");
    expect(bridge).toContain("current.negotiated_transport = response.transport.clone()");
    expect(bridge).toContain("prefer_shared_memory_art_input(&state.negotiated_transport)");
  });
});
