# Release Process

Use this process for a public GitHub release. The npm registry is not part of the `0.1.x` distribution contract.

## Preconditions

- the intended version is consistent in `package.json`, `src/version.ts`, and `CHANGELOG.md`;
- `main` is current and has no unrelated changes;
- the changelog describes user-visible behavior and compatibility changes; and
- the target tag and release do not already exist.

## Local release candidate

```bash
npm ci
npm run release:check
npm run audit:dependencies
```

`release:check` proves type safety, tests, deterministic benchmark gates, public-source hygiene, production build, and package contents.

Build the distributable and checksum:

```bash
mkdir -p release
npm pack --pack-destination release
shasum -a 256 release/decision-deliberation-*.tgz > release/SHA256SUMS
```

Install the tarball in a fresh temporary directory and verify:

```bash
mkdir -p /tmp/decision-deliberation-install-check
cd /tmp/decision-deliberation-install-check
npm init -y
npm install /path/to/release/decision-deliberation-X.Y.Z.tgz
./node_modules/.bin/deliberate --version
./node_modules/.bin/deliberate --help
```

## Publish

1. Push the reviewed commit to `main`.
2. Wait for hosted CI to pass.
3. Create signed or annotated tag `vX.Y.Z` from that commit.
4. Create the GitHub release and attach the `.tgz` plus `SHA256SUMS`.
5. Install from the public release URL and rerun the CLI smoke test.
6. Verify repository visibility, default branch, release tag, assets, Discussions, security settings, and community profile.

The artifact attached to GitHub is immutable release evidence. Never replace a published version; increment the version for every change.
