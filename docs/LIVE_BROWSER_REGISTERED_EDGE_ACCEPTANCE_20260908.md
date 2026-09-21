# Registered Edge native-messaging acceptance

Newest build and fresh-run status are in `LIVE_BROWSER_CANDIDATE_20260908.md`.
In particular, later r18/r19 picker timeouts mean the earlier three-pass result
below must not be read as a completed reliability gate.

## Latest checkpoint: native ACL validation and actual Loom activation

The r7 native launcher validates private discovery ACLs through Win32 handles,
without starting PowerShell for each packaged validation. The installed native
executable and runtime were updated; the stable r6 extension identity below is
unchanged. Registered captures r15, r16 and r17 passed consecutively, including
original-region updates after source scrolling and tab switching, navigation
rejection, and discovery cleanup. Their `summary.json` files are under
`artifacts/edge-live-registered-capture-20260908-r15` through `-r17`.

The fixture now waits for the actual selection-offered action state instead of a
fixed delay. Its viewport quiet wait is bounded to five seconds and removes its
listener/timers on success or failure. A viewport resize during an active drag
still cancels production selection rather than accepting incorrect geometry.

The signed local development capability was installed through the real Loom
registry and explicitly approved/enabled in the running daemon. The authenticated
extensions endpoint now exposes prepare/open commands. Prepare uses Hook's
generic extension command router; only open needs the dedicated Live controller
adapter. This is not proof that the user's old Hook executable includes that
adapter. A new candidate build and full native shell acceptance are separate
gates. Existing Hook instances must exit normally before the single-instance
native acceptance can start; they have not been forcibly stopped.

The older checkpoints below describe earlier revisions.

## Latest checkpoint: stable installed extension and resize correction

The extension is now copied to the stable installed directory
LocalApplicationData/Neuro/BrowserLive/extension, rather than loaded from a
versioned release path. Its actual ID is now
`gmhnbbhnghdgaomkjlnhaoggdllclkoa`; both owned host configuration and native manifest
were updated to this exact origin. Earlier ID references below are historical.

Repeated real Edge action testing exposed BROWSER_SELECTION_CANCELLED before any
drag. Owned-page instrumentation recorded viewport resize events as the debugger
banner appeared. The picker previously cancelled even before pointerdown; it now
ignores resize until a drag has pinned geometry. Resize during a drag still
cancels. The native installer now includes the extension in the stable directory.

The r6 worker was built and copied to that stable path. Latest registered capture
acceptance r11 passed, including an explicit pre-drag resize regression:
`artifacts/edge-live-registered-capture-20260908-r11/summary.json`.
Original-region updates survived tab switching and source scrolling; navigation
was rejected and discovery removed. An earlier r10 run disconnected during native
startup, so cold-start reliability is still unresolved; r11 is not presented as a
multi-run stability gate. Native profile/Hook shell integration is still pending.

## Authorized installation

The user confirmed Edge is already installed and authorized continuing installation.
No second browser was installed. The existing Edge executable reports 152.0.4191.66.
The production r5 extension worker loaded in an owned, separate Edge profile, with
actual ID `hkbmgmnnkmpfggiclgppgmfhcdmnkgam`. The user's ordinary browser profile,
logins, tabs and existing extensions were not changed.

The native installer Apply branch was executed with explicit candidate acceptance.
It created the private current-user `Neuro/BrowserLive` directory and Edge native
registration for `org.neuro.browser_live`, restricted to that exact extension
origin. Installed launcher, Node, runtime and license hashes match r5. The native
registration and installed component are retained; no fake extension ID was used.

Installation evidence: Loom `artifacts/browser-native-edge-installed-20260908.json`.
The unpacked extension remains under the r5 component directory; changing its path
without a stable packaged extension identity can change the ID. This is a
development installation, not an Edge Add-ons publication or official signature.

## Real registered transport acceptance

`artifacts/edge-live-registered-capture-20260908-r7/summary.json` records success:

1. Started the installed runtime and prepared discovery.
2. Triggered the production extension action on one owned loopback source tab.
3. Used the production isolated picker to drag a 320 by 160 CSS-pixel region.
4. Edge launched the registered native executable; the actual named-pipe/native
   messaging path offered the selection and delivered captures. No mocked native
   port, injected fixture worker or direct debugger screenshot replaced this path.
5. Switching to a different tab kept capturing the original document.
6. Scrolling the hidden source to y=1400 kept capturing the selected original
   region, while the other tab remained visible. Three increasing frame IDs and
   distinct PNG hashes confirm updates. Offscreen PNG was visually checked: it
   shows the original green region and updated clock, not the blue other tab.
7. Navigating the original tab rejected capture with BROWSER_DOCUMENT_CHANGED.
8. Runtime deactivation removed discovery. Fresh process inspection found zero
   owned Edge and zero installed native-host processes after acceptance.

The driver uses the documented [Extensions.triggerAction](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/#method-triggerAction)
on a CDP `tab` target; a `page` target is not interchangeable. Browser registration
follows [Edge native messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging).

## Corrections and limitations

Early attempts exposed several distinct boundaries, not a uniformly green run:
fresh Edge startup alongside runtime ACL inspection produced a sanitized host
failure; an action attempted on a page rather than tab target was rejected; a
reused-profile probe encountered stale DevTools discovery; one picker startup
timed out. The final driver starts the prepared runtime before launching a fresh
owned Edge profile and uses an actual tab target. Cold-start reliability remains
a release concern and has not been inferred from a single success.

The framed runtime client is a test driver, not CapabilityRuntimeHost admission.
Earlier Rust acceptance covers test-signed real-host admission separately. Neither
test grants production capability trust. This round still does not run the actual
Hook shell or install the extension into the user's normal Edge profile. Full
Hook acquisition/normal Ctrl+2 integration and release packaging remain pending;
the original user objective is not marked complete.

The three added TS acceptance files passed strict type checking and ESLint.
Hook strict size checking passed: 1121 files, none above 500 effective lines.
Both independent repositories passed diff checks with existing line-ending warnings.
No application executable was rebuilt in this test/tooling round; installed
payloads are the previously built and hash-verified r5 candidate.
