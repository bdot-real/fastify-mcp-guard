# Security Policy

`fastify-mcp-guard` is an authorization layer, so vulnerabilities in it can let agents perform actions they should not. Reports are taken seriously and handled privately.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.x (latest minor) | ✅ |
| Older 0.x minors | ❌ |

Before 1.0, only the latest minor release receives security fixes.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request.**

Report privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/bdot-real/fastify-mcp-guard/security/advisories/new)).

Please include:

- Affected version(s) and configuration (engine adapter, approval store, route setup)
- A description of the issue and its impact, e.g. a policy bypass, approval replay or audit gap
- Steps or a minimal proof of concept to reproduce it

## What to expect

- **Acknowledgement** within 3 business days
- **Initial assessment** within 7 days, including whether the report is accepted
- **Fix and advisory** coordinated with you; we aim to release a fix within 30 days for high-severity issues
- **Credit** in the advisory, unless you prefer to remain anonymous

## Scope

In scope: authorization bypass in `tools/call` interception or `tools/list` filtering, policy evaluation errors that fail open, approval flow flaws (argument swapping, replay, double approval, separation-of-duties bypass), and sensitive data leaking into audit logs or spans despite redaction settings.

Out of scope: authentication (delegated to `@fastify/jwt` or an upstream gateway), vulnerabilities in your own policies, and issues in third-party dependencies that are already publicly reported upstream.
