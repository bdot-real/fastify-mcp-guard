# 007. Transport-agnostic core with thin transport adapters

- **Status:** Accepted
- **Date:** 2026-09-24
- **Related:** #9, [landscape survey](../research/2026-09-landscape.md), refines [ADR-001](./001-hook-vs-proxy.md)

## Context

ADR-001 puts enforcement in a route-scoped `preHandler` hook. The survey (#9) looked at six Fastify MCP transports and found:

- **All of them dispatch Fastify's parsed `request.body`,** so one interception point on the request side works everywhere.
- **Responses differ.** The SDK-based transports (`@modelcontextprotocol/fastify` with server v2, `fastify-mcp`, `fastify-mcp-server`) write straight to `reply.raw` or hijack the reply, and default to SSE. Only `@platformatic/mcp` and its fork return POST responses through `reply.send`. So `onSend` can't filter `tools/list` in general.
- **No transport exposes registered tools with their input schemas** through a public API.
- **Where the principal lives differs:** `request.auth` (SDK v2 helpers, `fastify-mcp-server`), `request.tokenPayload` (platformatic), or custom.
- **Two protocol eras are live:** 2025-era, with sessions and batches up to 100, and 2026-07-28, which has no sessions, rejects batches and adds `Mcp-Method`/`Mcp-Name` headers.

The question from the spec: integrate deeply with one transport, or stay transport-agnostic?

## Decision

The guard's core (interceptor, decision context, engine, approvals, audit) is **transport-agnostic**. It depends only on the Fastify request and the parsed JSON-RPC body. Differences between transports sit behind a small adapter with defaults that cover the common cases:

```ts
interface McpTransportAdapter {
  /** Which routes to guard. Default: `url === options.route`, method POST. */
  matchRoute (route: RouteOptions): boolean
  /** Where the verified principal comes from. Defaults cover request.auth and request.tokenPayload. */
  principal (request: FastifyRequest): Principal | undefined
  /** Registered tools with input schemas: user-supplied, from a wrapped server, or discovered at boot. */
  listTools (): Promise<Array<{ name: string, inputSchema: JSONSchema }>>
  /** How tools/list is filtered: an onSend rewrite, or wrapping the MCP server's handler. */
  toolListFilter: 'onSend' | 'server'
}
```

- **Request side (all transports):** an `onRoute` hook appends the guard to the matching route's `preHandler` array. The guard therefore runs after the transport's own route-level auth. It authorizes from the body only, never from the `Mcp-Method`/`Mcp-Name` headers. Array bodies are evaluated element by element, and string or Buffer bodies are denied.
- **Response side:** `onSend` filtering is used where the transport replies through `reply.send` (platformatic). For SDK-based transports the guard wraps the MCP server (factory or `tools/list` handler) so only allowed tools are registered or returned.
- **Supported first:** `@modelcontextprotocol/fastify` with server v2 (the largest user base and the official SDK) and `@platformatic/mcp` (Fastify-native, from the Fastify maintainers). Each gets an integration test suite. The others are expected to work through the defaults and are documented as best-effort.

## Alternatives considered

### Integrate deeply with one transport

For example, build on platformatic's decorators and `onSend`-friendly responses.

- **For:** simpler filtering and a tool registry to work from.
- **Against:** excludes the official SDK path, which has about 20 times the downloads, and ties the guard to one transport's internals.

### Ship our own MCP transport with the guard built in

- **Against:** replacing a transport is an explicit non-goal. It would compete with the SDK instead of complementing it.

### Guard at the MCP SDK layer only

Wrap `McpServer` request handlers instead of using Fastify hooks.

- **Against:** loses the HTTP context and the cheap early rejection (see ADR-001). It also doesn't cover platformatic, which doesn't use the SDK.

## Consequences

- One interception path covers every transport surveyed. Transport-specific code is limited to principal lookup, tool discovery and `tools/list` filtering.
- **ADR-001's assumption that `onSend` could filter `tools/list` is corrected here:** that only holds for platformatic-style transports.
- Tool discovery is its own problem (#19, #22). The options are a user-supplied tool list, a wrapped server factory, or an injected `tools/list` at `onReady`, which needs a principal allowed to list tools.
- Two integration test suites (SDK v2 and platformatic) are added to M1 and M2 scope, alongside `fastify.inject` unit tests.
- Supporting both protocol eras is required from day one. Tests cover batches (2025-era) and the header cross-check (2026-07-28).
