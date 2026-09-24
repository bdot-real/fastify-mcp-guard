# 001. Enforce in a Fastify `preHandler` hook, not a separate proxy

- **Status:** Accepted
- **Date:** 2026-09-23
- **Related:** #6

## Context

`fastify-mcp-guard` has to decide, for every MCP `tools/call`, whether the calling agent may run that tool with those arguments. The answer is allow, deny or require approval. The decision needs three inputs:

1. **The verified principal.** Authentication is out of scope and is handled before us by `@fastify/jwt` or an upstream gateway.
2. **The parsed JSON-RPC message:** method, tool name and arguments.
3. **The server's registered tools and their input schemas,** to type the policy context and to filter `tools/list`.

The enforcement point has to see all three before the tool handler runs. It also has to add little latency: the target is under 1 ms p99 per decision and under 10% req/s loss against an unguarded server.

The target users already run their MCP server inside Fastify over the Streamable HTTP transport. They should be able to adopt the guard with a single `fastify.register(...)` call.

Fastify's request lifecycle offers several places to intervene: `onRequest` → `preParsing` → body parsing → `preValidation` → schema validation → `preHandler` → handler → `preSerialization` → `onSend` → `onResponse`.

## Decision

Enforce inside the Fastify process, as a `preHandler` hook scoped to the configured MCP route, and ship it as a plugin wrapped in `fastify-plugin`.

- **`preHandler` is the earliest hook where everything is available.** By then, authentication hooks (typically `onRequest`) have attached the principal, Fastify has parsed the JSON body once, and any route schema has validated it. The guard reuses `request.body` and never parses the body a second time.
- **Deny and require-approval short-circuit** by sending the JSON-RPC response from the hook, so the tool handler never runs.
- **The hook is registered only on the MCP route,** so other routes pay no cost.

## Alternatives considered

### Standalone proxy or sidecar gateway

A separate process in front of the MCP server that terminates HTTP, applies policy and forwards allowed calls.

- **For:** works with any MCP server in any language or framework, isolates policy evaluation from the tool process, and fits teams that already run an API gateway.
- **Against:**
  - Adds a network hop, and a second parse and serialize of every message, which works against the latency target.
  - Adds another service to deploy, scale, secure and monitor.
  - The proxy can't see the server's registered tool schemas. They would have to be fetched through `tools/list` or configured twice, and could drift.
  - The principal must be re-derived from the token or passed in a trusted header. That makes a new trust boundary that is easy to get wrong.
  - Replaying an approved call means going back through the network, which widens the time-of-check to time-of-use window that ADR-004 has to close.
  - It isn't what Fastify users expect; the ecosystem's convention is "register a plugin".

Rejected for v0.1. The core (interceptor, engine, approvals, audit) is kept free of Fastify-specific types where practical, so a proxy mode can be built later as a thin Fastify app that registers this plugin in front of `@fastify/http-proxy`.

### `onRequest` or `preParsing` hook

- **For:** runs before body parsing, so denied requests cost less.
- **Against:** the JSON-RPC method and tool arguments are only known after parsing. Enforcing here would mean reading and parsing the raw stream ourselves, which doubles parsing work and risks disagreeing with the body Fastify later hands to the handler (a parser-differential bypass). Authentication may also not have run yet.

### `preValidation` hook

- **For:** runs after parsing, slightly earlier than `preHandler`.
- **Against:** route-schema validation of the JSON-RPC envelope hasn't happened yet, so the guard would have to defend against malformed shapes itself. The time saved is negligible compared with policy evaluation.

### Wrapping the MCP SDK server or tool handlers

Intercept inside the MCP server object, for example by wrapping each tool callback.

- **For:** transport-agnostic, and would cover stdio as well.
- **Against:**
  - Ties the guard to one SDK's internal API and version.
  - Requests arrive without HTTP context (principal, request ID, headers), so identity would have to be threaded through the SDK.
  - Can't cheaply reject before the transport has started a response or an SSE stream.
  - Stops being a Fastify plugin, which is the point of the project.

Not chosen for v0.1. It stays a candidate for stdio support later.

## Consequences

**Easier**
- One-line adoption: `await fastify.register(mcpGuard, { route: '/mcp', ... })`.
- No extra network hop and a single body parse, which gives the latency targets the best chance.
- Direct access to the verified principal, Fastify's logger (Pino) and request ID for audit, and to the in-process tool registry for policy context and `tools/list` filtering.
- Approved calls can be replayed in process with `fastify.inject`, with no network re-entry.

**Harder or constrained**
- **Only traffic through the guarded route is protected.** If the same MCP server is also exposed on another route, port or transport, that path is unguarded. The README and threat model (#7) must state that the guarded route has to be the only ingress.
- **Hook order is load-bearing.** Authentication must run before the guard. The plugin will check at startup that a principal resolver is configured, and it will fail closed (deny) if the resolver throws or returns nothing.
- **Response-side work needs a second hook.** Filtering `tools/list` needs `onSend` (or answering `tools/list` from the registry directly), and it must handle both plain JSON responses and SSE streams from the Streamable HTTP transport. This is designed in #22.
- **Non-Fastify MCP servers can't use v0.1.** That is intended; proxy mode is on the roadmap (#59).
- **Policy evaluation shares the tool process's resources.** Pathological policies could affect tool latency. The Cedar spike (#15) and the benchmark suite (#31) will measure this.
- **Integration depends on the transport plugin.** The guard assumes the MCP handler is a Fastify route with the JSON body already parsed. The survey (#9) will confirm that for the Fastify MCP transport plugins that exist.
