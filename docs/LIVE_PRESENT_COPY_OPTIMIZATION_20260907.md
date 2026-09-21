# Live busy-present copy elimination

## Concrete change

`live_gpu/presenter.rs` previously issued `CopyResource` before every nonblocking
Present attempt, including repeated attempts of the exact same owned frame after
`DXGI_ERROR_WAS_STILL_DRAWING`. With several overloaded surfaces, retries thus
added GPU copy work without changing the image.

Each surface now remembers the content already copied into its pending backbuffer.
Busy retries of that content skip the copy; newer content replaces it immediately.
A successful presentation clears the marker because the next backbuffer needs
new content. Surface removal/recreation also starts with an empty marker.

`live_gpu/frame.rs` assigns a process-wide atomic copy ID after every actual owned
texture copy. Clones retain the ID; reused textures receive a new ID. Neither a
COM texture pointer nor a millisecond timestamp alone can identify its content.
The marker retains no texture or GPU handle and adds no queue or waiting path.

The underlying API returns a failed presentation rather than blocking when
DO_NOT_WAIT cannot proceed. See Microsoft's
[DXGI_PRESENT documentation](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/dxgi-present).
Only the explicit busy result preserves the marker; successful presentation
clears it and other errors keep the existing failure path.

## Fresh validation

- `artifacts/live-present-copy-test.log`: the new busy/new-content/flip-state
  regression passed, with a fresh Rust compilation.
- `artifacts/live-present-copy-native.log`: real WGC crop, two swapchains,
  changing source pixels, texture reuse snapshots, sibling removal and plane
  cleanup passed (1 native test, zero failures).
- `artifacts/live-present-copy-lib.log`: 390 passed, 16 ignored, zero failures.
- `artifacts/live-present-copy-lines.log`: strict effective-line checker passed.
- Cargo formatter and Hook/Loom diff checks passed.

## Six-video follow-up

`artifacts/live-present-copy-six-20260907-r1/native-summary.json` and `browser.json`
record a successful real six-crop Chrome video run with this source change.
All six GPU surfaces were presenting without errors; GPU-phase CPU grants were
zero. Submitted counters were 146, 190, 150, 123, 138 and 186, including warmup;
these are not measured per-Unit display FPS. Chrome used D3D11VideoDecoder,
decoded 1671 additional frames and dropped one additional frame over the probe.
Final work demands were zero with no CPU permit held. A fresh audit found no
remaining process using this run's browser profile or artifact path.

A simultaneous unrelated Gateway Rust compilation was observed before the run.
It was not stopped. This is correctness/cleanup evidence, not a controlled
before/after performance comparison or a six-WebView application benchmark.

The first invocation failed before starting the fixture because the PowerShell
profile resolves `node` to a Node 20 function without `--experimental-strip-types`.
The completed run explicitly used the installed Node 22.22.2 executable.
The native Unit wrapper now resolves only Application commands, avoiding that
function's empty executable Source, and retains the child process handle for
reliable PowerShell 5.1 exit-code reporting. A real short Node subprocess verified
the executable resolution and exit code 0; parser and strict line checks passed.

## Limits and next verification

This optimization is now packaged in the separate local candidate
`release/Hook/live-present-copy-20260907-r1/V0.2.28`. Its digest-bound headless
smoke passed; the packaged Ctrl+2 test still failed before Live creation, and
formal verification rejected dirty provenance. See that candidate's
`VALIDATION.md`; it is not a formal release. V0.2.27 does not contain this change.
The native test checks actual image correctness but does
not deterministically force a busy swapchain; that branch is covered by the pure
state regression. No before/after whole-machine latency improvement is claimed.

Producer-side copies of newer frames remain latest-only rather than FIFO. This
change deliberately does not drop newer frames merely because presentation is
busy, since doing so could trade lower load for stale video.

An independent review also flagged existing same-size D3D device replacement:
the presenter currently rebuilds surfaces on size change, not device identity.
That pre-existing recovery boundary needs a dedicated device-replacement test
before changing composition ownership. It was not expanded into this patch.

The active goal remains incomplete: packaged Ctrl+2 acceptance, whole-app
multi-Live performance, browser scroll/tab anchoring, dynamic admission ownership
and final release packaging still require their own evidence.
