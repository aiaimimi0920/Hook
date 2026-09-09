# Hook version identities

Public releases use `vx.y.z`, for example `v0.2.30`. Internal iterations use
`vx.y.z.n`, for example `v0.2.30.1` and `v0.2.30.2`. An internal iteration does
not consume the next public patch number.

## Internal development

Run `npm run version:internal` once when starting a new internal iteration.
Commit the resulting `version-state.json` with that iteration. The allocator
increments only `internalRevision`, serializes concurrent allocations, and
refuses invalid state or a revision beyond 65535. Rebuilding the same iteration
does not allocate another revision.

The public base remains in package.json, npm/Cargo lockfiles, Cargo.toml, and
tauri.conf.json. These tools require SemVer, so their version fields must not
contain a fourth numeric component. `version-state.json` must name the same
public base; the build preflight rejects a mismatch.

Local builds default to the internal channel. Their `build-provenance.json`
records `productVersion`, `internalRevision`, `buildVersion` (four parts with a
lowercase v), and `channel: internal`. Windows executable product metadata
continues to report the three-part public base. The full internal identity is
in the adjacent provenance file; no UI version display is added by this policy.

Revision zero is the release baseline; the first subsequent internal iteration
allocates revision one. Rebuilding does not allocate a new revision.
Internal builds should be stored under the matching four-part release directory,
for example `release/Hook/v0.2.30.1`.

## Public release

Only an explicit public release request advances the public base. Align all
package versions, set `version-state.json.publicVersion` to that base, and reset
`internalRevision` to zero. Validate with `npm run verify:version`.

Use `build-release.ps1` and the reviewed tag workflow. The formal builder passes
`-PublicRelease` to the local builder, producing `channel: public` and a
three-part `buildVersion`. Formal packaging and verification reject prepared
internal candidates instead of relabeling them. Build provenance, SBOMs,
checksums and smoke evidence must be regenerated for the release commit.

New tags are lowercase `vx.y.z`. Existing uppercase `Vx.y.z` tags remain valid
for historical signing. Four-part tags are excluded from the tag-triggered
public workflow and rejected by public publication validation, including manual
dispatch. Never move or overwrite a published tag.
