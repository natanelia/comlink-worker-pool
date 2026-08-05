# Security Policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or a private repository security advisory. Do not open a public issue for an unpatched vulnerability, leaked credential, suspicious npm stage, or suspected package compromise.

Include the affected version or commit, reproduction steps, impact, and any indicators of compromise. Maintainers should preserve logs and avoid approving or deleting suspicious staged packages until evidence has been collected.

## Supply-chain guarantees

This repository uses defense in depth against npm supply-chain attacks, including self-propagating lifecycle-script malware such as Shai-Hulud:

- Bun and npm dependency lifecycle scripts are disabled globally and explicitly in CI.
- CI rejects lifecycle hooks, non-registry dependency specifications, floating GitHub Action references, persisted checkout credentials, and reusable npm tokens.
- GitHub Actions are pinned to immutable commit SHAs.
- Dependency changes receive a dedicated dependency-review check.
- Dependabot monitors both `bun.lock` and GitHub Actions, with a cooldown for newly published versions; security updates are not delayed by that cooldown.
- Changesets runs only in read-only jobs. It produces a checksummed patch that a maintainer must inspect, apply, and submit through a normal pull request.
- Package builds run without npm publishing credentials.
- Release tarballs are packed once, checksummed, uploaded as an immutable workflow artifact, and passed to a separate staging job.
- npm publication uses OIDC trusted publishing with `npm stage publish`. A staged package cannot become public until a maintainer inspects and approves it with npm 2FA.
- GitHub Releases are created only after both npm packages are publicly visible at the requested version and their source manifests match the immutable release commit.
- Security-sensitive paths have two code owners: `@natanelia` and `@Joezer-Ivan`.

These controls materially reduce compromise paths, but no repository can guarantee immunity if both GitHub administrative access and npm proof-of-presence credentials are compromised. Maintainers must complete and retain the external controls below.

## Required GitHub settings

Configure a branch ruleset for `main` that applies to administrators and:

1. Requires a pull request before merging.
2. Requires at least one approval and Code Owner approval.
3. Dismisses stale approvals when new commits are pushed.
4. Requires all conversations to be resolved.
5. Requires the following status checks:
   - `supply-chain-policy`
   - `dependency-review`
   - `lint`
   - `typecheck`
   - `coverage`
   - `security`
   - `version-preview`
   - `test`
   - `build`
   - `node-18-packages`
   - `browser`
6. Blocks force pushes and branch deletion.

Also configure:

- A tag ruleset protecting `v*` from deletion or non-release modification.
- Default GitHub Actions workflow permissions as read-only.
- GitHub Actions must not be allowed to create or approve pull requests.
- The `npm-release` environment must require approval from a maintainer other than the workflow initiator.
- The `github-release` environment must require approval.
- Dependency graph, Dependabot alerts, Dependabot security updates, malware alerts, secret scanning, push protection, and private vulnerability reporting must be enabled.
- Web commit signoff should be required where practical.

## Required npm settings

For both `comlink-worker-pool` and `comlink-worker-pool-react`:

1. Enable WebAuthn-based two-factor authentication on every maintainer account.
2. Configure one GitHub Actions trusted publisher:
   - Owner: `natanelia`
   - Repository: `comlink-worker-pool`
   - Workflow: `stage-release.yml`
   - Environment: `npm-release`
   - Permission: **allow staged publishing only**; do not allow direct `npm publish`
3. Set Publishing access to **Require two-factor authentication and disallow tokens**.
4. Revoke `NPM_TOKEN`, legacy automation tokens, granular tokens with package write access, and unused sessions.
5. Periodically audit package maintainers and the trusted publisher configuration.

## Release procedure

1. Run **Prepare version PR patch** from `main`.
2. Download the `version-packages-<commit>` artifact and verify `version-packages.patch` with its SHA-256 checksum.
3. Create a branch from that exact `main` commit, apply the patch with `git apply --index version-packages.patch`, inspect all versions and changelogs, commit, and open a normal pull request.
4. Merge the version pull request only after all required checks and independent Code Owner review.
5. Run **Stage npm release** from `main` with the exact package version.
6. After the workflow succeeds:
   - Open npm's staged packages view.
   - Inspect the stage metadata and provenance.
   - Download each staged tarball.
   - Compare its SHA-256 digest with `SHA256SUMS` in the `npm-release-<version>-<commit>` workflow artifact.
   - Inspect the tarball contents. Only `dist/`, package metadata, README, license, and changelog files are allowed.
7. Approve each staged package with npm 2FA only after the review passes.
8. Run **Finalize npm release** with the exact version and commit shown by the staging workflow.
9. Confirm the GitHub Release tag points to that commit and both npm package pages show provenance.

Never approve a stage merely because CI is green. The human review is the final independent boundary against a compromised build dependency or GitHub workflow.

## Suspected compromise response

1. Do not approve pending npm stages. Download them for evidence, then reject them with 2FA.
2. Disable the release workflows and revoke npm trusted-publisher access if the workflow or repository may be compromised.
3. Revoke GitHub sessions, PATs, SSH keys, deploy keys, OAuth grants, npm sessions, and package tokens.
4. Audit recent commits, workflow runs, environment approvals, npm provenance, package maintainers, tags, releases, and published versions.
5. Rotate any exposed downstream credentials.
6. Deprecate or unpublish affected package versions when npm policy permits, and publish a clean replacement from a reviewed commit.
7. Notify consumers through a GitHub security advisory and package deprecation message.
