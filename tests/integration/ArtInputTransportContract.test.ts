import { describe, expect, it } from "vitest";
import { readLoomOtterRustSources } from "../helpers/loomOtterRustSources";

describe("Art input transport contract", () => {
  it("uses negotiated shared memory for large local inputs while retaining inline-resource fallback", () => {
    const bridge = readLoomOtterRustSources();

    expect(bridge).toContain("SHARED_MEMORY_ART_INPUT_MIN_BYTES");
    expect(bridge).toContain("fn prepare_otter_input(");
    expect(bridge).toContain('"kind": "shared_memory"');
    expect(bridge).toContain("shmem_guard: Some(SafeShmem(shmem))");
    expect(bridge).toContain("prepare_inline_otter_input(image)");
    expect(bridge).toContain('"kind": "inline_resource"');
    expect(bridge).not.toContain('"HOOK_ART_INPUT_TRANSPORT"');
    expect(bridge).not.toContain('"shm"');
    expect(bridge).not.toContain('"input_type=base64 has_reference_input_image=');
  });

  it("binds the transport choice to the negotiated local session", () => {
    const bridge = readLoomOtterRustSources();

    expect(bridge).toContain("negotiated_transport: TransportMode");
    expect(bridge).toContain("current.negotiated_transport = response.transport.clone()");
    expect(bridge).toContain("prefer_shared_memory_art_input(&state.negotiated_transport)");
  });
});
