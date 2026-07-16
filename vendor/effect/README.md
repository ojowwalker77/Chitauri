# Vendored Effect preview packages

The whole codebase is written against the Effect 4 preview line (the
`Effect-TS/effect-smol` repo). Until a stable Effect 4 ships, we depend on a
snapshot of commit `8881a9b606d84a6f5eb6615279138322984f5368`, which reports
version `4.0.0-beta.25` but is **ahead of** the npm-published `4.0.0-beta.25`
(819 dist files differ — verified 2026-07-16).

These tarballs were originally served by
`https://pkg.pr.new/Effect-TS/effect-smol/<pkg>@8881a9b`. pkg.pr.new builds are
ephemeral CI artifacts with no retention guarantee, so they are vendored here;
each tarball was verified byte-identical to the copy the old URLs installed
(and `@effect/openapi-generator` matches the sha512 recorded in `bun.lock`).
`SHA256SUMS` provides an independent, reviewable checksum set used by CI.

Wiring (bun resolves `file:` specs relative to the **consuming** package.json,
not the workspace root):

- Depth-2 workspaces (`apps/*`, `packages/*`): served by the root catalog via
  `file:../../vendor/effect/<pkg>.tgz`.
- `scripts/` (depth 1): declares direct `file:../vendor/effect/<pkg>.tgz` deps
  because the catalog path cannot fit both depths.
- `@effect/platform-node-shared` is a transitive dep of `@effect/platform-node`
  and is redirected through a root `overrides` entry (`file:./vendor/...` —
  root-relative works there because the consumer lives in the bun store).

Known quirk (pre-existing, not introduced by vendoring): Bun's isolated store
resolves the _peer_ `effect` of these packages to a separate registry copy nested
inside the store. The old pkg.pr.new setup had the identical shape; application
code always receives the vendored `effect`. The transitive
`@effect/platform-node-shared` dependency is pinned through the root override.

## Updating to a newer snapshot

1. Download the new tarballs (pkg.pr.new URL or `npm pack` of a published
   version) for: effect, @effect/platform-node, @effect/platform-node-shared,
   @effect/openapi-generator, @effect/sql-sqlite-bun, @effect/vitest.
2. Drop them here with the commit/version in the filename; update the paths in
   the root `package.json` catalog + overrides and in `scripts/package.json`.
3. `bun install`, then verify `grep -c pkg.pr.new bun.lock` only shows
   metadata inside the platform-node entry (its declared deps), and that
   `@effect/platform-node-shared` _resolves_ to the vendored file.
4. Once a real Effect 4 release exists, delete this directory and pin the
   catalog to the npm version instead.
