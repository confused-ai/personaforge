# Adapters

This mirrored guide has been reduced to the current stable guidance.

- Use the primary guide in `docs/guide/adapters.md` for the source-backed content.
- The public adapter surface stays inside the single `personaforge` package.
- Prefer `createProductionSetup()`, then a registry, then explicit bindings as complexity grows.