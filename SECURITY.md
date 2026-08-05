# Security Policy

## Supported versions

Security fixes are provided for the latest tagged release. Upgrade to the newest release before reporting an issue that may already be fixed.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, credential exposure, project-trust bypass, or unsafe child-process or extension-loading path.

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/aefreedman/pi-subagents/security/advisories/new>

Include the affected package version or commit, Pi and Node.js versions, operating system, reproduction steps, expected and observed behavior, impact, and known mitigations. Avoid real credentials, private prompts, session content, or sensitive repository data.

## Scope

Security-sensitive areas include project-agent trust, package-agent provenance, child process construction, extension forwarding, working-directory and path containment, model/tool restrictions, nested delegation, temporary prompt files, and delegated environment propagation.
