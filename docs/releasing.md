# Releasing the Opaline CLI

`opaline` is the recommended public install name. `@opalinehq/cli` contains
the shared implementation. The `opaline` and `rudel` packages provide thin
launchers that depend on the exact matching `@opalinehq/cli` version.

## One-time npm setup

In each package's npm settings (`opaline`, `@opalinehq/cli`, and `rudel`),
configure a GitHub Actions trusted publisher:

| Field | Value |
| --- | --- |
| Organization | `evrendom` |
| Repository | `opaline` |
| Workflow filename | `release.yml` |
| Environment | `npm-publish` |

Allow direct publishing with `npm publish`. npm requires a separate trusted
publisher configuration for each package; granting `evrendom` write access
does not automatically authorize GitHub Actions. The repository field must
match the GitHub repository running the workflow, including any repository
rename. The publish job uses GitHub-hosted Ubuntu and Node 24.

See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

## Automated releases

1. Merge a conventional-commit PR to `main` and let CI pass.
2. Release Please creates one `opaline-cli` release PR. Its `extra-files`
   configuration updates both launchers' versions and exact dependency pins.
   The workflow refreshes `bun.lock` on that release PR so frozen installs
   continue to work. Review all three package manifests and the lockfile.
3. Merge the release PR. Release Please creates the GitHub release and the
   `opaline-cli@<version>` tag. There are no separate `rudel@*` or `opaline@*`
   Git tags: the existing repository tag rules remain compatible with this flow.
4. The publish job checks out the `opaline-cli@<version>` release commit,
   verifies that it is reachable from `main`, and validates matching package
   versions and dependency pins.
5. It runs `bun run verify`, publishes `@opalinehq/cli` with provenance, waits
   for registry availability, then publishes `opaline` and `rudel` with the
   same version and the `latest` tag.

All three install names remain supported. Do not deprecate or unpublish the
compatibility packages when maintaining or releasing the CLI.

Release Please tracks changes under `apps/cli`. A launcher-only change should
include an update to the CLI's installation documentation under `apps/cli`
in the same conventional-commit PR so it triggers a shared release.

## Retrying a partial release

Run the **Release** workflow with `release_tag` set to the existing
`opaline-cli@<version>` tag. Successfully published versions are skipped;
missing packages are published from the same released commit. Fix package
ownership or trusted publishing settings before retrying an authorization
failure. Do not change package contents and reuse an already published version.

## Verification after publishing

```bash
npm view opaline version dependencies
npm view @opalinehq/cli version
npm view rudel version dependencies
npx --yes opaline@latest --version
npx --yes @opalinehq/cli@latest --version
npx --yes rudel@latest --version
```

The three commands should report the same CLI version. `rudel` also emits
its existing rename notice to stderr. Migration instructions for existing
global installations are in the [CLI guide](usage.md#optional-global-install).

# Releasing the Opaline Mac app

The Mac app releases itself from GitHub Actions (`.github/workflows/desktop-release.yml`).

## Releasing

Change `"version"` in `apps/desktop/shell/package.json` in a pull request. Use semver, higher than the last `desktop-v*` release. When it merges, the workflow:

1. builds the app for Apple silicon (`macos-15`) and Intel (`macos-15-intel`) with `apps/desktop/shell/package.sh`;
2. signs it with the Developer ID and notarizes it;
3. publishes it with `apps/desktop/shell/publish.sh`. The Apple silicon build creates release `desktop-v<version>`, and the Intel build adds itself to it. Installed apps offer the update on their next check.

The release notes are the `feat`, `fix` and `perf` commit titles under `apps/desktop`, `packages` and `plugin` since the previous `desktop-v*` tag.

A release that failed part way is finished from Actions → Desktop Release → Run workflow. It builds only the chips the release does not have yet.

## One-time signing setup

The `release` environment holds five secrets:

| Secret | What it is |
|---|---|
| `DESKTOP_SIGNING_CERTIFICATE_P12_BASE64` | The "Developer ID Application: Evren Dombak (M8L5AS39YN)" certificate with its private key, exported from Keychain Access as `.p12`, then `base64 -i certificate.p12` |
| `DESKTOP_SIGNING_CERTIFICATE_PASSWORD` | The password chosen for that export |
| `DESKTOP_NOTARY_KEY_P8` | The contents of an App Store Connect API key (`AuthKey_….p8`): Users and Access → Integrations → Team Keys, role Developer |
| `DESKTOP_NOTARY_KEY_ID` | That key's ID |
| `DESKTOP_NOTARY_ISSUER_ID` | The issuer ID shown above the keys |

Set them with `gh secret set <NAME> --env release` (for example `base64 -i certificate.p12 | gh secret set DESKTOP_SIGNING_CERTIFICATE_P12_BASE64 --env release`). The workflow stops with a named error when one is missing.

## By hand

`apps/desktop/shell/publish.sh --help` describes the manual procedure the workflow runs.
