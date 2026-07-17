# Security Policy

## Supported versions

The latest `0.1.x` release receives security fixes. Earlier preview builds are unsupported.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability or leaked credential. Use [GitHub's private vulnerability reporting](https://github.com/katooling/decision-deliberation/security/advisories/new) and include:

- affected version or commit;
- reproduction steps;
- expected impact;
- any known workaround; and
- whether the report contains sensitive data.

The maintainer will acknowledge a complete report when available, investigate it, and coordinate disclosure through the advisory. This volunteer project does not promise a fixed response-time SLA.

## Security boundaries

- The viewer binds to loopback by default and is read-only.
- Command providers execute a configured local process. Treat provider commands and their working directories as trusted configuration.
- Run artifacts may contain prompts, evidence, model output, costs, or other sensitive decision context. Keep private runs outside public repositories.
- The system recommends decisions but does not execute them.

Run `npm run audit:release` before publishing any source or artifact. The audit detects common credentials, private keys, private work email addresses, and machine-specific paths; it complements rather than replaces GitHub secret scanning and human review.
