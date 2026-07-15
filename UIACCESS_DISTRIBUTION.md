# Hook UIAccess Distribution Notes

This document explains both:

- why Hook has a future **installer / UIAccess** path; and
- why the project is currently in a **portable-first** public release phase.

## The short version

- **Portable** is the current public release package and the current recommended
  package for users.
- **Installer** is the future signed package path that Hook is still preparing,
  but it is not the current public release package yet.

The difference is not cosmetic. It comes from how Windows enforces **UIAccess**
 and foreground-window security rules.

## Why the installer package exists

Hook uses a transparent desktop overlay and needs to stay interactive even when
special Windows foreground windows are active.

One concrete example is **Task Manager**:

- a normal portable Hook build can still work for most everyday capture and
  sticker workflows;
- but when Task Manager is the foreground window, Windows may stop a portable
  build from receiving the same level of input/interaction that the installed
  UIAccess path can keep.

This is a Windows policy boundary, not just a frontend bug.

## Why portable and installer are not equivalent

For Windows to honor a UIAccess desktop application, the executable must be all
of the following:

1. built with a `uiAccess=true` manifest;
2. **digitally signed**;
3. installed into a **trusted location** such as `Program Files`.

Because of that:

- a **portable** package cannot promise the same behavior in every
  foreground/elevation scenario;
- an **installer** package is the correct path for users who want the best
  compatibility in scenarios like Task Manager foreground interaction.

## Current phase: portable-first public releases

Hook is currently shipping only the portable public release because the project
does not yet have real public release signing material wired into the GitHub
release path.

That means the current user-facing recommendation is:

- use the portable package;
- if a special Windows foreground/elevation scenario causes interaction limits,
  try launching Hook as **administrator** as the current workaround.

This is a transition strategy, not the final ideal distribution model.

## Future phase: signed installer public releases

Hook still intends to publish a signed installer/UIAccess package again once a
real signing provider path is ready for public release use.

At that point:

- the signed installer can return as a public release artifact;
- the installer path can again become the recommended option for the most
  reliable Windows interaction scenarios.

## User-facing guidance

### Installer (future signed phase)

Choose the installer package when:

- you plan to use Hook as a long-running desktop tool;
- you want the best chance of reliable interaction under special foreground
  windows such as Task Manager;
- you want the binary installed into `Program Files`, which is part of the
  trusted-location requirement for UIAccess.

This package path is being kept ready in-repo, but it is not the current public
release package until signing is available.

### Portable (current phase)

Choose the portable package when:

- you want the currently supported public release package;
- you want a no-install trial or ordinary daily screenshot workflow quickly;
- you accept that some Windows foreground/elevation combinations may still
  limit interaction and may require administrator launch as a workaround.

If you must stay on the portable package and hit one of those Windows
restrictions, a fallback is to try launching Hook as **administrator**. That is
the current phase workaround, not the preferred long-term distribution model.

## Install and uninstall notes

### Installer / UIAccess package

- install by extracting the installer zip and running `install-hook.ps1` from an
  elevated PowerShell session;
- the helper installs `hook.exe` into `Program Files\yamiyu\Hook`;
- uninstall by closing Hook and removing the installed `Program Files\yamiyu\Hook`
  directory and any shortcuts you created for it.

### Portable package

- install by extracting the zip anywhere you control;
- uninstall by closing Hook and deleting the extracted portable folder.

## Maintainer notes

The repository keeps future dual distribution engineering in place, even though
the current public phase is portable-first:

- **portable zip** is the baseline public artifact;
- **installer zip** is the signed UIAccess-oriented package;
- the installer package stages:
  - `hook.exe`
  - `install-hook.ps1`
  - `install-hook-uiaccess.ps1`

## GitHub Actions requirements

Portable releases can be generated without signing and are the only current
public release artifacts.

Installer/UIAccess releases require a real code-signing certificate in GitHub
Actions. The current workflow contract expects these secrets:

- `HOOK_WINDOWS_UIACCESS_PFX_BASE64`
- `HOOK_WINDOWS_UIACCESS_PFX_PASSWORD`

Until those secrets are actually available for public release use, the current
public GitHub Actions release posture should stay portable-first rather than
pretending an unsigned installer path is currently publishable.
