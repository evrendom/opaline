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

The CLI is retired: every release from 0.18.0 on only removes what earlier
versions installed (see the [CLI guide](usage.md)). Keep all three packages
published and never unpublish them: the names must stay ours, because hooks
and scripts on users' computers still run `opaline`, `rudel` and
`@opalinehq/cli`. Deprecate the packages only after the retiring release is
published and verified.

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

Every command of a retired release cleans up the computer it runs on, so run
the checks with a throwaway home directory:

```bash
npm view opaline version dependencies
npm view @opalinehq/cli version
npm view rudel version dependencies
export HOME="$(mktemp -d)"
npx --yes opaline@latest --version
npx --yes @opalinehq/cli@latest --version
npx --yes rudel@latest --version
```

The three commands should report the same CLI version.

## Deprecation

Once the retiring release is verified, deprecate every version of all three
packages so installs show the notice. Deprecated packages still install and
run, so `npx opaline@latest` keeps working:

```bash
for package in opaline @opalinehq/cli rudel; do
  npm deprecate "${package}@*" "Opaline's cloud has shut down. Run npx opaline@latest once to remove its upload hooks. The free Mac app: https://opaline.evren.so"
done
```
