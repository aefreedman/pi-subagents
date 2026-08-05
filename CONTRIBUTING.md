# Contributing

Thanks for improving Pi Subagents.

## Prerequisites

- Node.js 22.19.0 or newer
- npm

## Setup and validation

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm pack --dry-run
```

The default suite must remain credential-free and deterministic. Review the tarball inventory for machine-specific paths, credentials, private prompts, session data, generated results, and unrelated files.

## Making changes

- Preserve project-trust, path-containment, process, model, tool, and nested-delegation safeguards.
- Treat project agent definitions and forwarded extensions as untrusted until the owning trust checks pass.
- Add focused regression coverage for behavior changes.
- Update README and `docs/architecture.md` when user-facing or architectural behavior changes.
- Keep unreleased user-visible work under `## Unreleased` until release preparation.
- Do not bump versions for intermediate implementation commits.

## Pull requests

Describe the behavior changed, safety implications, validation performed, checks intentionally skipped, and any compatibility impact. Do not include credentials, private prompts, project data, full session transcripts, or raw provider payloads.

## Security reports

Follow [SECURITY.md](SECURITY.md) instead of opening a public issue for vulnerabilities.
