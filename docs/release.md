# Release Checklist

This document covers how to run signed, notarized desktop releases from one tag.

## What the workflow does

- Trigger: push a SemVer tag, either `vX.Y.Z` (the canonical form) or legacy
  `X.Y.Z`. The published GitHub Release keeps the exact pushed tag name.
  The workflow can also be started manually (`workflow_dispatch` with a
  `version` input) — `gh workflow run "Release Desktop" -f version=X.Y.Z` —
  which releases from the current `main` head and tags it `vX.Y.Z`.
- Runs quality gates first: lint, typecheck, test.
- Builds artifacts in parallel:
  - Linux `x64` AppImage
  - Windows `x64` NSIS installer
  - macOS `arm64` + `x64` DMG — **only when the repository variable `RELEASE_MAC` is set to `1`**
- Publishes one GitHub Release with all produced files.
  - Versions with a suffix after `X.Y.Z` (for example `1.2.3-alpha.1`) are published as GitHub prereleases.
  - Only plain `X.Y.Z` releases are marked as the repository's latest release.
- Includes Electron auto-update metadata (for example `latest*.yml` and `*.blockmap`) in release assets.
- Publishes the CLI package (`apps/server`, npm package `t3`) with OIDC trusted publishing.
- macOS signing and notarization are required. The workflow fails before packaging if any required Apple secret is missing, so it can never publish a Gatekeeper-rejected app.

## macOS is currently built locally

The Apple signing secrets are not configured yet, so `RELEASE_MAC` is unset and CI
ships Linux and Windows only. macOS builds are produced locally instead, signing
directly from the `Developer ID Application` identity in the login Keychain — no
`.p12` and no repository secrets involved:

```bash
T3CODE_DESKTOP_UPDATE_REPOSITORY=<owner>/<repo> \
  bun run dist:desktop:artifact -- --platform mac --target dmg --arch arm64 --signed
```

`T3CODE_DESKTOP_UPDATE_REPOSITORY` is required: it supplies the publish config that
makes electron-builder emit `latest-mac.yml`. Without it the build fails late, in
update-zip finalization, with `Expected at least one macOS update manifest, found 0`.
The build never uploads (`--publish never` is hard-coded); the artifact lands in
`release/`.

A locally-built app is signed but **not notarized**. That is fine on the machine that
built it (no quarantine attribute), and not fine for distribution to anyone else.

To put macOS back into the release: configure the Apple secrets in section 2 below,
then set the repository variable `RELEASE_MAC=1` (`gh variable set RELEASE_MAC --body 1`).

## Desktop auto-update notes

- Runtime updater: `electron-updater` in `apps/desktop/src/main.ts`.
- Update UX:
  - Background checks run on startup delay + interval.
  - New updates are prepared/downloaded in the background after detection; install/restart stays manual.
  - The desktop UI shows a rocket update button while preparing and switches to an install action once the update is ready.
- Provider: GitHub Releases (`provider: github`) configured at build time.
- Repository slug source:
  - `T3CODE_DESKTOP_UPDATE_REPOSITORY` (format `owner/repo`), if set.
  - otherwise `GITHUB_REPOSITORY` from GitHub Actions.
- Required release assets for updater:
  - platform installers (`.exe`, `.dmg`, `.AppImage`, plus macOS `.zip` for Squirrel.Mac update payloads)
  - `latest*.yml` metadata
  - `*.blockmap` files, except the macOS update `.zip.blockmap` removed after zip repack
- Production desktop builds omit web/server/desktop source maps by default to keep update payloads small. Set `SYNARA_WEB_SOURCEMAP=1`, `SYNARA_SERVER_SOURCEMAP=1`, or `SYNARA_DESKTOP_SOURCEMAP=1` only for a diagnostic release that needs them.
- macOS metadata note:
  - `electron-updater` reads `latest-mac.yml` for both Intel and Apple Silicon.
  - The workflow merges the per-arch mac manifests into one `latest-mac.yml` before publishing the GitHub Release.
  - The desktop build script repacks the macOS update `.zip` with `ditto`, verifies Electron framework symlinks, extracts the zip, validates the extracted app signature, patches the matching `latest-mac*.yml` hash/size, and removes the stale `.zip.blockmap`.
  - macOS updater downloads intentionally use the full zip payload so Squirrel.Mac installs the exact signed archive validated by release build.
- Local smoke test:
  - Run `bun run release:smoke:mac-update -- --skip-build --build-version 0.1.5` on macOS after local desktop/server/web dist files exist.
  - The smoke builds a mock update artifact, validates manifest hash/size, serves a HEAD-only local endpoint, confirms the manifest and zip are addressable without downloading the zip body, then cleans up its temp output.
  - Boolean env flags for release scripts accept `true/false`, `1/0`, `yes/no`, and `on/off`; CLI flags are still preferred for repeatable local commands.

## 0) npm OIDC trusted publishing setup (CLI)

The workflow publishes the CLI with `bun publish` from `apps/server` after bumping
the package version to the release tag version.

Checklist:

1. Confirm npm org/user owns package `t3` (or rename package first if needed).
2. In npm package settings, configure Trusted Publisher:
   - Provider: GitHub Actions
   - Repository: this repo
   - Workflow file: `.github/workflows/release.yml`
   - Environment (if used): match your npm trusted publishing config
3. Ensure npm account and org policies allow trusted publishing for the package.
4. Create release tag `vX.Y.Z` and push; workflow will:
   - set `apps/server/package.json` version to `X.Y.Z`
   - build web + server
   - run `bun publish --access public`

## Chitauri notes

- `Chitauri` publishes signed desktop artifacts for macOS, Windows, and Linux.
- The desktop updater expects the GitHub Release in this repository to include the generated updater metadata files, not just the installers.
- The published release title should read `Chitauri vX.Y.Z`.
- By default, the first-party desktop release path does not require CLI publish or post-release version-bump automation.
- Optional jobs stay disabled unless repository variables enable them:
  - `DPCODE_PUBLISH_CLI=1`
  - `DPCODE_FINALIZE_RELEASE=1`

## 1) Test release

Use this to validate the release pipeline after Apple signing and notarization are configured.

1. Confirm the Apple signing and notarization secrets below are configured.
2. Create a test tag:
   - `git tag v0.0.0-test.1`
   - `git push origin v0.0.0-test.1`
3. Wait for `.github/workflows/release.yml` to finish.
4. Verify the GitHub Release contains all platform artifacts.
5. Download each artifact and sanity-check installation on each OS.

## 2) Apple signing + notarization setup (macOS)

The workflow requires a signing certificate and one notarization credential set.
It accepts both Chitauri's canonical names and BonsAI's existing aliases.

Signing certificate (choose either naming pair):

- `CSC_LINK`
- `CSC_KEY_PASSWORD`

or:

- `MACOS_CERT_P12_BASE64`
- `MACOS_CERT_PASSWORD`

Notarization via App Store Connect API key:

- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`

or notarization via Apple ID:

- `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD`
- BonsAI's `APPLE_APP_PASSWORD` name is accepted as an alias for
  `APPLE_APP_SPECIFIC_PASSWORD`.

Checklist:

1. Apple Developer account access:
   - Team has rights to create Developer ID certificates.
2. Create `Developer ID Application` certificate.
3. Export certificate + private key as `.p12` from Keychain.
4. Base64-encode the `.p12` and store it as `CSC_LINK` or
   `MACOS_CERT_P12_BASE64`.
5. Store the `.p12` export password as `CSC_KEY_PASSWORD` or
   `MACOS_CERT_PASSWORD`.
6. Configure one notarization method:
   - App Store Connect API key (recommended for CI):
     - `APPLE_API_KEY`: contents of the downloaded `.p8`
     - `APPLE_API_KEY_ID`: Key ID
     - `APPLE_API_ISSUER`: Issuer ID
   - Apple ID:
     - `APPLE_ID`: Apple Developer account email
     - `APPLE_TEAM_ID`: Developer team ID
     - `APPLE_APP_SPECIFIC_PASSWORD` or BonsAI's `APPLE_APP_PASSWORD`: an
       app-specific password, not the Apple ID password
7. Re-run a tag release and confirm macOS artifacts are signed/notarized.

Notes:

- `APPLE_API_KEY` is stored as raw key text in secrets. The workflow writes it
  to a temporary `AuthKey_<id>.p8` file at runtime.
- GitHub Actions secrets are repository-scoped and write-only. Secrets already
  present in BonsAI must be added to Chitauri separately, using either supported
  naming convention.

## 3) Azure Trusted Signing setup (Windows)

Required secrets used by the workflow:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

Checklist:

1. Create Azure Trusted Signing account and certificate profile.
2. Record ATS values:
   - Endpoint
   - Account name
   - Certificate profile name
   - Publisher name
3. Create/choose an Entra app registration (service principal).
4. Grant service principal permissions required by Trusted Signing.
5. Create a client secret for the service principal.
6. Add Azure secrets listed above in GitHub Actions secrets.
7. Re-run a tag release and confirm Windows installer is signed.

## 4) Ongoing release checklist

1. Ensure `main` is green in CI.
2. Bump app version as needed.
3. Create release tag: `vX.Y.Z` (preferred; legacy `X.Y.Z` tags are also supported).
4. Push tag.
5. Verify workflow steps:
   - preflight passes
   - all matrix builds pass
   - release job uploads expected files
6. Smoke test downloaded artifacts.

## 5) Troubleshooting

- macOS build unsigned when expected signed:
  - Check all Apple secrets are populated and non-empty.
- Windows build unsigned when expected signed:
  - Check all Azure ATS and auth secrets are populated and non-empty.
- Build fails with signing error:
  - Retry with secrets removed to confirm unsigned path still works.
  - Re-check certificate/profile names and tenant/client credentials.
