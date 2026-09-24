# Architecture Decision Records

This directory records the significant design decisions behind `fastify-mcp-guard`: what was decided, what else was considered, and why.

Each ADR is immutable once accepted. To change a decision, write a new ADR that supersedes the old one and update the old one's status.

| ADR | Title | Status |
| --- | --- | --- |
| [001](./001-hook-vs-proxy.md) | Enforce in a Fastify `preHandler` hook, not a separate proxy | Accepted (response-side note refined by 007) |
| [007](./007-transport-agnostic-core.md) | Transport-agnostic core with thin transport adapters | Accepted |

## Writing a new ADR

Copy [`template.md`](./template.md) to `NNN-short-title.md` with the next free number, fill it in, and open a pull request. Add it to the table above. ADRs 002–006 are reserved for the decisions listed in the project plan and are written in their milestones.
