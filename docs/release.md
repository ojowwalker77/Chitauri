# Desktop release runbook

Chitauri releases are built, signed, notarized, and published by GitHub Actions.
Do not build release DMGs on a developer machine.

## Release flow

Pushing `vX.Y.Z` starts `.github/workflows/release.yml`. Manual dispatch is also
available with `gh workflow run "Release Desktop" -f version=X.Y.Z`.

The workflow:

- resolves release metadata in a short preflight;
- runs lint, typecheck, and tests in parallel with artifact builds;
- builds Linux x64, Windows x64, and—when enabled—macOS arm64 and x64;
- requires both signing and notarization for every macOS artifact;
- merges the two macOS updater manifests and publishes one GitHub Release;
- uploads installers, update archives, blockmaps, and `latest*.yml` metadata.

Production source maps are disabled by default. A diagnostic release can enable
`CHITAURI_WEB_SOURCEMAP=1`, `CHITAURI_SERVER_SOURCEMAP=1`, or
`CHITAURI_DESKTOP_SOURCEMAP=1` in the build environment.

## Current repository configuration

Check names without revealing values:

```bash
gh secret list --repo ojowwalker77/Chitauri
gh variable list --repo ojowwalker77/Chitauri
```

GitHub secrets are encrypted and write-only. Add them from files or stdin; never
paste credential values into the repository, an issue, a PR, or a shell command
that will remain in history. See [GitHub's secrets documentation](https://docs.github.com/en/actions/concepts/security/secrets).

### Required for remote macOS releases

Repository secrets:

- `CSC_LINK`: base64-encoded Developer ID Application `.p12`.
- `CSC_KEY_PASSWORD`: password used when exporting that `.p12`.
- `APPLE_API_KEY`: raw contents of the App Store Connect team key `.p8`.
- `APPLE_API_KEY_ID`: the key ID shown beside that team key.
- `APPLE_API_ISSUER`: the issuer ID shown on the App Store Connect API page.

Repository variable:

- `RELEASE_MAC=1`: includes both macOS runners after all five secrets exist.

### Optional Windows signing

Repository secrets:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

Windows artifacts remain unsigned until all seven values exist. Linux does not
use a code-signing secret.

### Optional automation

- `CHITAURI_PUBLISH_CLI=1` enables npm publishing. Leave it unset while the CLI
  depends on the vendored Effect preview tarballs.
- `CHITAURI_FINALIZE_RELEASE=1` enables the post-release version commit and also
  requires `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` repository secrets.
- `CHITAURI_DESKTOP_UPDATE_REPOSITORY` is only needed for an unusual local
  packaging invocation. GitHub Actions supplies `GITHUB_REPOSITORY`
  automatically, so it is not a repository secret.

## Apple setup: obtain all five values

Apple requires Developer ID signing plus notarization for software distributed
outside the Mac App Store. The workflow uses an App Store Connect **team** API
key; individual keys cannot be used by `notarytool`. Apple's notarization
requirements are documented in [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
and team-key creation is documented in [Creating API keys for App Store Connect](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api).

### 1. Create the Developer ID Application certificate

This requires the Apple Developer Program Account Holder (or an authorized team
member with Developer ID certificate access).

1. On the Mac that will create the private key, open **Keychain Access**.
2. Choose **Keychain Access → Certificate Assistant → Request a Certificate
   From a Certificate Authority**.
3. Enter the Apple Developer email, select **Saved to disk**, and save the CSR.
4. Open [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list),
   add a certificate, choose **Developer ID Application**, and upload the CSR.
5. Download the `.cer`, open it, and confirm the certificate appears under
   **login → My Certificates** with an expandable private key.
6. Select the certificate and its private key, export them as a password-protected
   `.p12`, and keep the export password in a password manager.

Upload the certificate without writing base64 to disk:

```bash
base64 < /secure/path/Chitauri-Developer-ID.p12 \
  | gh secret set CSC_LINK --repo ojowwalker77/Chitauri
read -r -s "P12_PASSWORD?P12 export password: "
printf '%s' "$P12_PASSWORD" \
  | gh secret set CSC_KEY_PASSWORD --repo ojowwalker77/Chitauri
unset P12_PASSWORD
```

### 2. Create the App Store Connect team API key

1. Sign in to [App Store Connect](https://appstoreconnect.apple.com/).
2. Open **Users and Access → Integrations → App Store Connect API**.
3. If API access has never been enabled, the Account Holder must request it.
4. Under **Team Keys**, generate a key named `Chitauri CI` with the
   **Developer** role; do not create an individual key.
5. Download `AuthKey_<KEY_ID>.p8` immediately. Apple allows one download.
6. Copy the **Key ID** and **Issuer ID** shown on the same page.

Upload the three values:

```bash
gh secret set APPLE_API_KEY --repo ojowwalker77/Chitauri \
  < /secure/path/AuthKey_KEYID.p8
gh secret set APPLE_API_KEY_ID --repo ojowwalker77/Chitauri --body 'KEY_ID'
gh secret set APPLE_API_ISSUER --repo ojowwalker77/Chitauri --body 'ISSUER_UUID'
```

After `gh secret list` shows all five names, enable macOS builds:

```bash
gh variable set RELEASE_MAC --repo ojowwalker77/Chitauri --body 1
```

## Azure setup: obtain all seven Windows values

Microsoft now calls Trusted Signing **Artifact Signing**. The setup requires an
Azure subscription, identity validation, an Artifact Signing account, and a
certificate profile. Follow Microsoft's [Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
and assign the CI service principal the **Artifact Signing Certificate Profile
Signer** role on the certificate profile, as required by the
[signing integration guide](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations).

1. In Azure Portal, create an Artifact Signing account and complete public
   identity validation.
2. Create a Public Trust certificate profile. Record the account name, profile
   name, endpoint, and exact verified publisher name.
3. In Microsoft Entra ID, create an app registration named `Chitauri GitHub CI`.
4. Record its **Application (client) ID** and the tenant **Directory (tenant) ID**.
5. Create a client secret and copy its **value** immediately—not its secret ID.
6. Assign the service principal **Artifact Signing Certificate Profile Signer**
   at the certificate-profile scope.
7. Store the values:

```bash
gh secret set AZURE_TENANT_ID --repo ojowwalker77/Chitauri --body 'TENANT_UUID'
gh secret set AZURE_CLIENT_ID --repo ojowwalker77/Chitauri --body 'CLIENT_UUID'
gh secret set AZURE_CLIENT_SECRET --repo ojowwalker77/Chitauri
gh secret set AZURE_TRUSTED_SIGNING_ENDPOINT --repo ojowwalker77/Chitauri --body 'https://REGION.codesigning.azure.net/'
gh secret set AZURE_TRUSTED_SIGNING_ACCOUNT_NAME --repo ojowwalker77/Chitauri --body 'ACCOUNT_NAME'
gh secret set AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME --repo ojowwalker77/Chitauri --body 'PROFILE_NAME'
gh secret set AZURE_TRUSTED_SIGNING_PUBLISHER_NAME --repo ojowwalker77/Chitauri --body 'VERIFIED_PUBLISHER_NAME'
```

The client-secret command intentionally prompts on stdin.

## Optional npm trusted publishing

No npm token is needed. On npmjs.com, open package `t3`, add a GitHub Actions
trusted publisher for `ojowwalker77/Chitauri` and `.github/workflows/release.yml`,
and permit the publish action required by npm. The workflow already grants
`id-token: write`. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

Do not enable `CHITAURI_PUBLISH_CLI` until the CLI has publishable dependency
specifiers instead of repository-local Effect tarballs.

## Release and verification

Use a prerelease first:

```bash
git tag v0.0.0-ci.1
git push origin v0.0.0-ci.1
gh run watch --repo ojowwalker77/Chitauri
```

Verify the downloaded macOS artifacts, not a local build:

```bash
codesign --verify --deep --strict --verbose=2 /path/to/Chitauri.app
spctl --assess --type execute --verbose=4 /path/to/Chitauri.app
xcrun stapler validate /path/to/Chitauri.app
```

For a normal release, push `vX.Y.Z`, wait for every quality/build job, and smoke
test each downloaded installer. The GitHub Release must contain `.dmg`, `.zip`,
`.AppImage`, `.exe`, `.blockmap`, and the applicable `latest*.yml` files.

## Troubleshooting

- **macOS job excluded:** `RELEASE_MAC` is missing or not exactly `1`.
- **certificate missing:** `CSC_LINK` is not base64 of a `.p12` containing both
  the Developer ID Application certificate and its private key.
- **notarization authentication failed:** confirm this is a team API key, its
  `.p8` matches `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` is the issuer UUID.
- **Windows signing failed:** confirm the service principal's role is assigned at
  the certificate profile and that the client-secret value has not expired.
- **updater metadata missing:** Actions should use `GITHUB_REPOSITORY`; local
  diagnostics must set `CHITAURI_DESKTOP_UPDATE_REPOSITORY=owner/repo`.
