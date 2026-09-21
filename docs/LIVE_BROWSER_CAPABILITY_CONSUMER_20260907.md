# Browser capability consumer: 2026-09-07

## Progress and remaining boundary

Implemented `extensionBrowserDocumentProvider.ts`: it implements the provider
interface consumed by the existing browser Live backend, using Loom's real
extension command client and registry by default. No new socket or unauthenticated
browser endpoint was introduced.

The provider runtime and browser grant/resolution flow are still missing. This
module is not registered as an available adapter and Ctrl+2 still starts native
capture. No new EXE was packaged and existing release candidates were preserved.
The complete scroll/tab-preserving Live objective remains unfulfilled.

## Security and lifecycle behavior

- A caller supplies contributed open/poll/close command IDs, the originating
  Unit target and the actual opening gesture token. The consumer does not mint
  authorization or follow the currently selected Unit during polling.
- Before invocation, package trust, command ownership, command scope and gesture
  declarations are checked against the authenticated contribution registry.
- Package digest, grant digest, version and scope are pinned for the session.
  Changes or bridge disconnect invalidate it; in-flight responses cannot become
  frames after that invalidation. The consumer removes its registry subscription.
- The command result must succeed, contain no effects, and use the exact browser
  payload protocol. Polls must echo the original session/document identity.
- Frame bytes are decoded only after bounded base64/MIME/sequence validation;
  this command path allows at most 1 MiB of decoded image data per frame.
- Explicit close is idempotent. Cancelled open closes a valid late result when
  the same grant remains authorized. When a grant is revoked, the consumer does
  not bypass Loom authorization to invoke the old package; runtime teardown and
  source lease expiry must perform cleanup.
- This first consumer exposes no input capability. The earlier backend can
  route input, but a real provider interaction contract is not implemented yet.

## Verification

- 11 focused tests passed for successful open/frame/close, three untrusted states,
  wrong command ownership/gesture declarations, three pinned-grant changes,
  disconnect during a poll, changed document/invalid frames/nonterminal results,
  and cancelled open cleanup.
- Tests use controlled bridge responses and registry changes. They do not prove
  an installed package can access a browser or that Ctrl+2 reaches this consumer.
- Test TypeScript compilation, focused ESLint and strict effective-line checker
  passed (1,107 files, none above 500 effective lines).
- Hook diff check passed; prior dirty changes were preserved. The only Loom
  change in this step is the candidate command contract document.

The matching candidate payload and runtime prerequisites are recorded in
`../Loom/protocol/BROWSER_DOCUMENT_PROVIDER.md`. The next implementation must be
the package/runtime side, especially browser grant resolution and independently
expiring source leases; another frontend mock does not close that gap.
