# Third-Party Notices

Hook is licensed under the MIT License. The complete resolved dependency
versions used by the public build are recorded in `package-lock.json` and
`src-tauri/Cargo.lock`.

Hook does not intentionally include proprietary Hook-owned components. The
project's direct dependencies and vendored source are distributed under
open-source licenses. Important bundled-source attribution follows.

## Cap `scap-*` capture crates

- Components: `scap-targets`, `scap-direct3d`
- Source family: <https://github.com/CapSoftware/Cap>
- License: MIT
- Copyright: Copyright (c) 2023 Cap Software, Inc.
- Local attribution: `src-tauri/crates/CAPTURE_CRATES_SOURCE.md`
- License text: `src-tauri/crates/LICENSE_CAP_SCAP_MIT`

Only the `scap-*` crate source covered by Cap's MIT grant was imported. Hook
does not import or relicense the rest of the Cap application under Hook's MIT
license.

## CrabNebula `drag` crate

- Component: `drag` 2.1.1
- Copyright holder: CrabNebula Ltd.
- License: Apache-2.0 OR MIT
- License texts:
  - `src-tauri/crates/drag/LICENSE_APACHE-2.0`
  - `src-tauri/crates/drag/LICENSE_MIT`

## Framework and package dependencies

- Tauri and its Rust/JavaScript ecosystem dependencies are used under the
  licenses declared by their package manifests and lockfile entries.
- SolidJS and frontend dependencies are used under the licenses declared by
  their package manifests and `package-lock.json` entries.
- Rust registry dependencies are used under the SPDX expressions recorded by
  Cargo metadata and `src-tauri/Cargo.lock`.

The Windows operating system, Windows SDK interfaces, and Microsoft Edge
WebView2 runtime are system/platform components. The portable release archive
does not redistribute a standalone WebView2 installer or private Windows SDK
component.

Run `npm run audit:licenses` after `npm ci` to check the current direct npm
manifests, the resolved Rust graph, and local Rust crate license metadata.
