import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Art input transport contract", () => {
  it("prefers shared memory for large local inputs while retaining Base64 fallback", () => {
    const bridge = readSource("src-tauri/src/mock_artloom.rs");

    expect(bridge).toContain("SHARED_MEMORY_ART_INPUT_MIN_BYTES");
    expect(bridge).toContain("fn prepare_ahrp_input(");
    expect(bridge).toContain('"type": "shared_memory"');
    expect(bridge).toContain("shmem_guard: Some(SafeShmem(shmem))");
    expect(bridge).toContain("prepare_base64_ahrp_input(image)");
    expect(bridge).toContain('"type": "base64"');
    expect(bridge).toContain('"HOOK_ART_INPUT_TRANSPORT"');
    expect(bridge).not.toContain('"input_type=base64 has_reference_input_image=');
  });

  it("binds the transport choice to the negotiated local session", () => {
    const bridge = readSource("src-tauri/src/mock_artloom.rs");

    expect(bridge).toContain("negotiated_transport: TransportMode");
    expect(bridge).toContain("s.negotiated_transport = transport.clone()");
    expect(bridge).toContain("prefer_shared_memory_art_input(&state.negotiated_transport)");
  });
});
