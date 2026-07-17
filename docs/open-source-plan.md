# Open-Source Readiness Plan

## Repository decision

Publish this project as `katooling/decision-deliberation`.

The organization boundary is intentional:

- `katooling` hosts useful end-user tools and browser utilities;
- `kaskilling` hosts installable agent skills;
- `kalibraring` hosts reusable application libraries; and
- `kapplicationing` hosts production applications.

Decision Deliberation is a user-facing tool with a CLI and interactive viewer. It can integrate agents, but it is not itself an agent skill or a general-purpose library.

## Steps for a good open-source project

### 1. Make the purpose and boundary obvious

- State the user problem before the architecture.
- Show one short installation and demo path.
- Label the project `public preview` and state what is unstable.
- State the evidence boundary and avoid universal performance claims.
- Explain when the project should and should not be used.

### 2. Establish legal and community expectations

- Include an OSI-compatible license in the repository.
- Add contribution, conduct, support, security, and governance policies.
- Add structured issue forms and a pull request template.
- Provide a private vulnerability-reporting path.

### 3. Make contributions reproducible

- Pin the supported Node.js version.
- Keep `npm ci`, `npm run verify`, and `npm run release:check` as canonical commands.
- Run the same verification in CI.
- Keep architecture invariants and ADRs near the code.
- Use Dependabot for dependency and workflow updates.

### 4. Publish only intentional artifacts

- Clean `dist/` before every build.
- Compile production source without compiled tests.
- Use the package `files` allowlist.
- Inspect `npm pack --dry-run` before release.
- Attach the package tarball and SHA-256 checksum to the GitHub release.

### 5. Protect users and maintainers

- Keep generated runs, model transcripts, local research, and output captures ignored.
- Scan tracked files for credentials, private keys, private work addresses, and machine-specific paths.
- Keep GitHub secret scanning and dependency alerts enabled.
- Pin third-party workflow actions to commit SHAs.
- Document the trusted-command-provider boundary.

### 6. Operate the project after launch

- Triage issues by user impact and reproducibility.
- Mark suitable first contributions explicitly.
- Record breaking changes and migrations in the changelog.
- Release from reviewed, passing commits.
- Review support load, security posture, and roadmap quarterly.

## Version `0.1.0` acceptance

- [x] Clear README, screenshot, quick start, limitations, and evidence boundary
- [x] MIT license
- [x] Contributing, conduct, support, security, and governance files
- [x] Issue forms and pull request template
- [x] Strict TypeScript checks and deterministic tests
- [x] CI and Dependabot configuration
- [x] Production-only build and package allowlist
- [x] Source audit for secrets and machine-specific paths
- [x] Clean-install and CLI smoke-test plan
- [x] Public repository created and remote tree verified
- [x] GitHub Discussions and private vulnerability reporting enabled
- [ ] `v0.1.0` release published with tarball and checksum
- [x] Hosted CI passes on `main`

The final four boxes are publication-state checks. They are checked only after verification against GitHub.
