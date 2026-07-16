# Pipeline performance map

Baseline: [Release Desktop run 29501921763](https://github.com/ojowwalker77/Chitauri/actions/runs/29501921763),
July 16, 2026, before the pipeline changes in this branch.

## Measured critical path

| Lane or step           | Duration | Why it mattered                                                               |
| ---------------------- | -------: | ----------------------------------------------------------------------------- |
| Entire release         |   16m43s | Quality ran first; artifact builds could not start for 5m33s.                 |
| Preflight total        |    5m33s | 30s install, 1m33s typecheck, 3m22s tests.                                    |
| Windows job            |   10m14s | Release critical path after preflight.                                        |
| Windows install        |    2m33s | Cold Bun/native dependency resolution on Windows.                             |
| Windows artifact build |    7m00s | Full web/server/desktop build, staged production install, Electron packaging. |
| Linux job              |    2m57s | 6s install, 2m28s artifact build.                                             |
| Publish release        |      44s | Artifact download plus GitHub Release upload.                                 |

The previous successful run showed the same pattern: Windows install took 3m06s
and its artifact step took 7m09s. This is structural, not random runner noise.

## Root causes

1. **Artificial serialization.** Release quality gates completed before any
   platform build started, adding the full 5m33s to wall time.
2. **One monolithic PR job.** Format, lint, typecheck, tests, Playwright, and the
   desktop build ran serially on one runner.
3. **Repeated cold downloads.** Bun packages, Electron, electron-builder helper
   tools, and Playwright browsers were not consistently cached.
4. **A second production install.** Desktop packaging creates a clean temporary
   app and runs `bun install --production`; this is necessary for a trustworthy
   distributable but makes dependency determinism and download caching critical.
5. **Ephemeral Effect packages.** Six core packages came from `pkg.pr.new`
   preview URLs. Besides retention risk, every cold runner depended on that
   external artifact service.
6. **Windows is inherently the slowest current target.** It performs the same
   application build plus native dependency setup and NSIS/electron-builder
   packaging, making it the release critical path.

## Changes in this branch

- Release metadata preflight is now seconds-only. Quality and all artifact
  runners start concurrently; publishing still requires both.
- PR CI uses independent parallel lanes for format, lint, typecheck, tests,
  browser tests, desktop build, and release smoke, with one stable `Quality`
  aggregation check for branch protection.
- Bun/Turbo, Electron/electron-builder, and Playwright caches are explicit.
- The six Effect preview tarballs are vendored and integrity-pinned. Desktop
  staging rebases those local files into its temporary production install.
- Redundant icon packages were removed in commit `c8893c3a`, shrinking installs
  by roughly 150 MB.

Without assuming any cache benefit, parallel release scheduling changes the
non-macOS critical path from approximately `5.5m + 10.2m + publish` to
`max(5.5m, 10.2m) + publish`, or roughly 11 minutes. Warm caches should reduce
Windows further; the first merged run is the benchmark, not an estimate.

## Next measurements

After GitHub Actions push/PR triggering is restored:

1. Record one cold and one warm CI run.
2. Record one release with `RELEASE_MAC=1`; there is no trustworthy macOS runner
   baseline yet.
3. If the Windows artifact step remains above six minutes, add timing around the
   application build, staged production install, native module rebuild, and
   electron-builder packaging separately.
4. Consider Turbo remote cache only after local Actions cache hit rates are
   measured. It adds credentials and invalidation complexity, so it should solve
   a demonstrated miss rather than be enabled speculatively.

## Current control-plane blocker

Manual `workflow_dispatch` works, but push and pull-request workflows do not
register because automatic check-suite triggering for the GitHub Actions app is
disabled on this repository. The repository Actions toggle itself is enabled.

The repair endpoint requires repository admin plus a fine-grained token with
**Checks: write**; the OAuth token used by `gh auth login` cannot perform it.
GitHub documents the endpoint under [Update repository preferences for check suites](https://docs.github.com/en/rest/checks/suites#update-repository-preferences-for-check-suites).

```bash
read -r -s "GITHUB_CHECKS_PAT?Fine-grained PAT (Checks: write): "
curl --fail-with-body --request PATCH \
  --header "Accept: application/vnd.github+json" \
  --header "Authorization: Bearer $GITHUB_CHECKS_PAT" \
  --header "X-GitHub-Api-Version: 2026-03-10" \
  https://api.github.com/repos/ojowwalker77/Chitauri/check-suites/preferences \
  --data '{"auto_trigger_checks":[{"app_id":15368,"setting":true}]}'
unset GITHUB_CHECKS_PAT
```

Create that token in **GitHub Settings → Developer settings → Personal access
tokens → Fine-grained tokens**. Limit repository access to `Chitauri`, grant
**Checks: Read and write**, use it once, then revoke it.
