# Native Live compositor idle scheduling

The native GPU owner previously woke every 16 ms even with no new frame, and
every unchanged configuration heartbeat woke it again. Empty iterations still
locked slots, collected active IDs and scanned compositor surfaces.

The owner now waits for a frame/control event or the earliest active lease
deadline. A queued busy-present retry retains the 16 ms ceiling. Source capture
and submitted video frame rates are unchanged: their existing bounded channel
wakes the owner immediately. Channel disconnection still interrupts shutdown.

Unchanged healthy configuration renews its 350 ms lease without waking the
owner. Layout changes and reactivation of an expired static surface still wake
it. Capture budget/copy errors also wake it so fault cleanup is not delayed.
After presenting outside the slot lock, the owner rechecks previously active
IDs and immediately iterates if a lease or fault changed during that work.

The scheduling policy test simulates static presentation and 160 ms heartbeats:
at most four deadline checks per second replace approximately 62 fixed timer
checks. This counts idle control-loop work, not measured whole-process CPU/GPU
usage. Dynamic video still needs per-crop GPU copies and swapchain presentation.

Tests protect heartbeat renewal/reactivation, earliest expiry, hidden/faulted
slots, busy retries, static-source fallback, source late join/resize/stop, and
compositor cleanup. Timing policy lives in `live_gpu/worker_schedule.rs`; texture
ownership, generation barriers and source subscription locks remain unchanged.
