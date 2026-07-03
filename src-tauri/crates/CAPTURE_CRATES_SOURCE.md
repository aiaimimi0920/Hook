# Capture crates source attribution

The crates in this directory were imported from the former top-level `Cap/`
source subset when Hook absorbed the Cap-like visual capture boundary.

Imported crates:

- `scap-targets`
- `scap-direct3d`

Original source context:

- Upstream project family: Cap / CapSoftware
- Previous local path: `Cap/crates/scap-targets` and `Cap/crates/scap-direct3d`
- The previous local `Cap/LICENSE` stated: "All code residing in the
  `cap-camera*` and `scap-*` families of crates is licensed under the MIT
  License".
- `scap-direct3d/Cargo.toml` declares `license = "MIT"`.

These crates are now Hook-owned implementation dependencies, not a separate
Neuro product or user-facing program. Keep source attribution and license
metadata intact when modifying them.
