# Hook capture crates

This directory contains Hook-owned capture backend crates imported from the old
top-level `Cap/` source subset.

These crates are not a separate Neuro product. They are local implementation
dependencies for Hook's screenshot and foreground capture backend.

Current imported crates:

- `scap-targets`
- `scap-direct3d`

Keep license/source attribution when changing these crates. If they later become
useful to multiple Neuro programs, move them to a shared capture package through
a separate planned migration.
