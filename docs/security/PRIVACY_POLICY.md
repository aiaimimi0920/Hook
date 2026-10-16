# Otter Privacy Policy

This privacy policy describes the behavior of the open-source Otter desktop
application and its public release repository.

## Summary

Otter is primarily a local desktop screenshot and sticker-editing tool.

Local capture does not require a cloud account. Native Otter does, however,
discover and connect to authenticated local Loom by default. A previously
authorized global Loom connection can also reconnect after restart. These
connection defaults are separate from initiating OCR, translation or projection;
the configured integration and active workflow determine what data is exchanged.

Outside the default authenticated local bridge and explicitly configured or
requested integrations described below, Otter
will not transfer any information to other networked systems.
This is not a promise of zero network activity when those integrations are active.

For the ordinary capture, pinning, annotation, and local session workflow:

- screenshots and sticker content stay on the user's machine;
- local session state and logs stay on the user's machine;
- Otter does not ship built-in third-party advertising or analytics SDKs.

## Data Otter stores locally

Depending on the feature being used, Otter may store local desktop data such as:

- captured images and temporary screenshot files;
- clipboard-cache files;
- local session graph/workspace state;
- sticker editing history and tool settings;
- runtime logs;
- the canonical `com.yamiyu.hook` local app-data directory.
- global application settings such as user-configured file-naming templates.

These files are stored in local app-data, temp-cache, or nearby runtime paths
described by the app configuration and release scripts.

## Network behavior

Otter's core screenshot/sticker workflow is local-first.

The native local Loom bridge is enabled by default and uses authenticated local
discovery. Set `OTTER_ENABLE_LOOM_OTTER=0` before starting Otter to disable that
bridge. The old `HOOK_ENABLE_LOOM_HOOK` is a fallback only when the canonical
variable is absent; see [environment precedence](../development/RENAMING.md#环境变量).
Pure browser preview does not establish this native bridge. A saved global Loom
connection has a separate [restart/reconnect lifecycle](../features/LOOM_CONNECTION.md);
disconnect it explicitly to cancel its remembered restart intent.

However, some optional features can talk to user-selected or locally configured
services, for example:

- local capability bridges such as **Loom** or **Talk** over loopback
  addresses;
- voice or workflow-related service calls;
- Tea ticket/intake integrations when that feature is configured by the user or
  maintainer environment.

When those optional integrations are used, the data sent depends on the feature
that the user triggers and the service endpoint that is configured.

Live collaboration remains usable against a local/private Loom without a cloud
account. The current build does not configure a Cloud Relay or TURN/SFU provider
and does not persist live frame bytes or OCR source text in a cloud service.
Its local network capability report contains no device token, pairing secret, or
proxy credential. Runtime and panic logs apply bounded credential and URL-query
redaction before writing diagnostics.

## What Otter does not do by default

Otter does not claim a built-in cloud-sync account system for ordinary screenshot
usage.

Otter also does not include built-in third-party telemetry products such as
advertising trackers or hosted analytics SDKs in the normal desktop capture
path.

## Third-party services and downloads

When you browse the public repository, download releases from GitHub, or use a
signing/distribution service linked from the project, those third parties may
process your network metadata under their own terms.

Examples include:

- GitHub
- a code-signing provider used for release publication

Those third-party policies are separate from Otter's own application behavior.

## User control

Because Otter is local-first, the main user controls are local machine controls:

- delete local screenshots or exported files;
- remove local app-data/runtime files;
- avoid enabling optional integrations you do not want to use;
- disable the default local Loom bridge before launch when it is not wanted,
  and explicitly disconnect saved global Loom connections rather than only closing their dialog;
- uninstall the app and remove local runtime directories if you no longer want
  Otter on the machine.

For package-specific install/uninstall notes, see [UIAccess distribution](../release/uiaccess-distribution.md).

## Policy updates

If Otter introduces a new hosted service, bundled telemetry system, or default
remote sync behavior, this policy must be updated before that release is
published.

## Contact

Privacy-related public questions can be filed at:

- GitHub Issues: `https://github.com/aiaimimi0920/Otter/issues`
