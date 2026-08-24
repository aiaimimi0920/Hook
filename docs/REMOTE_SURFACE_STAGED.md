# Cross-device remote Surface

Status: **enabled by default.** Activated 2026-08-23 after the staged safety gates passed.

The filename is retained as the activation record referenced by older progress documents. The
feature is no longer staged or compiled out in a normal Hook build.

## Runtime contract

Hook's default Cargo feature set includes `remote-surface`. It provides:

- a persistent Ed25519 device identity;
- Loom device pairing and signed device-session tokens;
- a bounded device-session cache;
- the long-poll `GET /v1/surfaces/stream` client;
- strict Surface stream protocol and reset handling.

On Windows, the Ed25519 private key is encrypted at rest for the current user
with DPAPI. A valid legacy schema-1 plaintext identity is migrated atomically to
protected schema 2 on first read. Older Hook builds cannot read schema 2; a
rollback to a pre-migration build can therefore require deleting the identity
and pairing the device again. Non-Windows compatibility builds retain the
schema-1 storage format and never claim DPAPI protection.

`cargo ... --no-default-features` builds the loopback-only compatibility variant. That variant
rejects remote Loom manifests and contains no pairing or remote poll runtime.

## URL policy

All Loom `baseUrl` values are parsed as URLs and must contain only an origin:

- no username or password;
- no path other than `/`;
- no query or fragment;
- scheme is `http` or `https`;
- non-loopback hosts require `https`;
- the local WebSocket path remains restricted to origin-only `http` loopback URLs.

Remote authorization decisions do not use string-prefix matching. Userinfo and origins carrying a
path/query/fragment are rejected. A lookalike host such as `127.0.0.1.evil.example` is classified
as remote (and therefore requires HTTPS and device pairing), never as loopback.

## Stream recovery policy

The Loom Surface stream reserves cursor `0` for an initial recovery request. Loom advances an
initial recovery to a non-message baseline cursor, so a snapshot-only response is not emitted again
on every poll and the first future broadcast is not skipped.

Hook requires `protocolVersion: "loom.surface-stream.v1"`, rejects cursor rewind, consumes the
required `reset` flag, and emits `surface/reset` before messages from a reset batch. The frontend
then clears mounted Surface state, confirmations, resource cache, attachment attempts, and remount
attempts before applying recovery snapshots. An unchanged successful cursor is also given a minimum
delay to prevent a malformed or older peer from causing a tight poll loop.

## Verification matrix

Run both feature combinations after changing Surface transport, pairing, or stream code:

```powershell
cargo fmt --check --manifest-path src-tauri\Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri\Cargo.toml
cargo test --no-fail-fast --manifest-path src-tauri\Cargo.toml

cargo clippy --all-targets --no-default-features --manifest-path src-tauri\Cargo.toml
cargo test --no-fail-fast --no-default-features --manifest-path src-tauri\Cargo.toml
```

The Loom side must continue to expose the versioned pairing/session/stream routes:

- `POST /v1/devices/requests`
- `POST /v1/device-sessions/challenges`
- `POST /v1/device-sessions`
- `GET /v1/surfaces/stream`
