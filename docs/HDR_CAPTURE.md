# HDR Capture

Hook uses an on-demand HDR path for ordinary region capture on Windows 11.

## Capture policy

- `auto` (default): when Windows reports that HDR is enabled for the capture display, Hook requests one transient `R16G16B16A16Float` Windows Graphics Capture frame.
- If the captured scRGB content exceeds the current Windows SDR white level, Hook writes a 16-bit RGB PNG encoded as BT.2020/PQ.
- If the content is SDR-only, Hook converts it to 8-bit sRGB instead of keeping a misleading HDR container.
- If HDR capture fails, Hook retries through the existing SDR WGC path and finally falls back to GDI.
- Long capture remains SDR so repeated sampling never creates HDR GPU sessions or adds HDR conversion work to the hot loop.

The optional `HOOK_CAPTURE_DYNAMIC_RANGE` environment variable accepts `auto`, `hdr`, or `sdr`. `hdr` preserves a successful float capture as HDR even when the content itself does not exceed the SDR white level. It still falls back safely when HDR is unavailable. `sdr` disables the HDR attempt.

## Output metadata

HDR PNG files contain:

- 16-bit RGB samples;
- BT.2020 color primaries;
- SMPTE ST 2084 (PQ) transfer metadata via PNG `cICP`;
- mastering display metadata (`mDCV`);
- content light level metadata (`cLLI`).

The capture response also reports `dynamicRange`, `bitDepth`, `colorSpace`, `captureBackend`, and `downgradedFromHdr`.

## Resource lifetime

The HDR frame pool and capture session are created for one region capture and stopped immediately after the frame is received. The default path never stores a persistent HDR or full-screen WGC session. This preserves Hook's existing memory and idle-CPU performance boundary.
