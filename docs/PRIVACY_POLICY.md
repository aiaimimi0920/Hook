# Hook Privacy Policy

This privacy policy describes the behavior of the open-source Hook desktop
application and its public release repository.

## Summary

Hook is primarily a local desktop screenshot and sticker-editing tool.

This program will not transfer any information to other networked systems
unless specifically requested by the user or the person installing or
operating it.

For the ordinary capture, pinning, annotation, and local session workflow:

- screenshots and sticker content stay on the user's machine;
- local session state and logs stay on the user's machine;
- Hook does not ship built-in third-party advertising or analytics SDKs.

## Data Hook stores locally

Depending on the feature being used, Hook may store local desktop data such as:

- captured images and temporary screenshot files;
- clipboard-cache files;
- local session graph/workspace state;
- sticker editing history and tool settings;
- runtime logs;
- local app-data compatibility paths used to keep older installs working.
- global application settings such as user-configured file-naming templates.

These files are stored in local app-data, temp-cache, or nearby runtime paths
described by the app configuration and release scripts.

## Network behavior

Hook's core screenshot/sticker workflow is local-first.

However, some optional features can talk to user-selected or locally configured
services, for example:

- local capability bridges such as **Loom** or **Talk** over loopback
  addresses;
- voice or workflow-related service calls;
- Tea ticket/intake integrations when that feature is configured by the user or
  maintainer environment.

When those optional integrations are used, the data sent depends on the feature
that the user triggers and the service endpoint that is configured.

## What Hook does not do by default

Hook does not claim a built-in cloud-sync account system for ordinary screenshot
usage.

Hook also does not include built-in third-party telemetry products such as
advertising trackers or hosted analytics SDKs in the normal desktop capture
path.

## Third-party services and downloads

When you browse the public repository, download releases from GitHub, or use a
signing/distribution service linked from the project, those third parties may
process your network metadata under their own terms.

Examples include:

- GitHub
- a code-signing provider used for release publication

Those third-party policies are separate from Hook's own application behavior.

## User control

Because Hook is local-first, the main user controls are local machine controls:

- delete local screenshots or exported files;
- remove local app-data/runtime files;
- avoid enabling optional integrations you do not want to use;
- uninstall the app and remove local runtime directories if you no longer want
  Hook on the machine.

For package-specific install/uninstall notes, see `UIACCESS_DISTRIBUTION.md`.

## Policy updates

If Hook introduces a new hosted service, bundled telemetry system, or default
remote sync behavior, this policy must be updated before that release is
published.

## Contact

Privacy-related public questions can be filed at:

- GitHub Issues: `https://github.com/aiaimimi0920/Hook/issues`
