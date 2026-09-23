# Contributing to fastify-mcp-guard

Thanks for your interest in improving `fastify-mcp-guard`. This document explains how to propose changes and what a pull request needs before it can be merged.

By participating you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Before you start

- **Bugs and features:** open an issue first so we can agree on the approach. Small fixes (typos, docs) can go straight to a pull request.
- **Scope:** v0.1 guards `tools/call` and filters `tools/list` on Streamable HTTP MCP servers hosted in Fastify. Work outside that scope goes to the pinned roadmap issue rather than into v0.1.
- **Security issues:** do not open a public issue. Follow [SECURITY.md](./SECURITY.md).

## Development setup

Requirements: Node.js 22 or 24, npm.

```sh
git clone https://github.com/bdot-real/fastify-mcp-guard.git
cd fastify-mcp-guard
npm install
npm test
```

| Script | What it does |
| --- | --- |
| `npm run lint` | Lints with [neostandard](https://github.com/neostandard/neostandard) (`lint:fix` to autofix) |
| `npm run typecheck` | Type checks sources and tests with `tsc` |
| `npm run unit` | Runs the test suite (`node:test` + `c8`) with a 100% coverage gate |
| `npm test` | Runs lint, typecheck and unit |
| `npm run check:exports` | Validates the published `exports` map with attw and publint |
| `npm run build` | Builds ESM + CJS output with `tsup` |
| `npm run bench` | Runs the `autocannon` benchmark suite |

Tests are written in TypeScript and run directly by Node's built-in type stripping, so there is no compile step. Source files therefore use erasable syntax only: no `enum`, `namespace` or constructor parameter properties. Relative imports keep their `.ts` extension.

## Pull request checklist

- [ ] Tests cover the change; coverage stays at **100% lines and branches**
- [ ] `npm test` passes locally on Node 22 or 24
- [ ] Public API changes include TypeScript types and TSDoc
- [ ] User-facing changes are reflected in the README or docs
- [ ] Changes that alter the decision path (interceptor, engine, approvals) include a benchmark run and note any overhead change
- [ ] Significant design decisions are recorded as an ADR in `docs/adr/`

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, …). Release notes and version bumps are generated from them by release-please, so the prefix matters.

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please):

1. Every merge to `main` updates an open **release PR** with the next version (from the Conventional Commit prefixes) and the generated `CHANGELOG.md`.
2. Merging the release PR tags the version, creates a GitHub release and publishes to npm from CI with [provenance](https://docs.npmjs.com/generating-provenance-statements).

Before 1.0, `feat:` bumps the minor version and `fix:` bumps the patch version. Nobody publishes from a laptop.

## Architecture decisions

Architecture Decision Records live in `docs/adr/`, numbered sequentially (`001-hook-vs-proxy.md`, …). Propose a new ADR in its own pull request when a change picks between real alternatives or reverses an earlier decision.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
