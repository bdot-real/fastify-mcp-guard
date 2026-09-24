# Landscape survey: Fastify MCP transports and MCP authorization projects

- **Date:** 2026-09-24
- **Issue:** #9
- **Outcome:** [ADR-007](../adr/007-transport-agnostic-core.md): transport-agnostic core with thin adapters. The "an existing project already covers this" risk is **not** triggered.

Method: I downloaded each package's published tarball with `npm pack`, read the built `dist` code, and ran small experiments against Fastify 5 and `@cedar-policy/cedar-wasm`. Download counts are for the week of 2026-09-15 to 09-21. File and line references point into the published `dist` of the version named.

## 1. Fastify MCP transports

### Summary

| Package | Version | Downloads/wk | Body source | Response path | Batches | Tool registry API | Built-in auth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [`@modelcontextprotocol/fastify`](https://www.npmjs.com/package/@modelcontextprotocol/fastify) + server v2 | 2.0.0 / 2.1.0 | 14.5k | `request.body` (the user passes it in) | Raw write to `reply.raw`; SSE by default | Legacy path: ≤100. 2026-07-28: rejected | None (`_registeredTools` is private) | Host/Origin checks, bearer authn helpers |
| [`fastify-mcp`](https://www.npmjs.com/package/fastify-mcp) | 3.0.0 | 9.6k | `req.body` | Raw write, no `hijack()` | SDK v1: ≤100 | None | None |
| [`fastify-mcp-server`](https://www.npmjs.com/package/fastify-mcp-server) | 1.0.0 | 2.4k | `request.body` | `reply.hijack()` then raw write | Rejected (2026-07-28 only) | None (factory per request) | Bearer authn |
| [`@getlarge/fastify-mcp`](https://www.npmjs.com/package/@getlarge/fastify-mcp) | 1.2.2 / 1.3.0-next | 1.3k | `request.body` | POST: `reply.send`; GET SSE: hijack | Unguarded (500) | `mcpAddTool` only | OAuth / OIDC authn |
| [`@platformatic/mcp`](https://www.npmjs.com/package/@platformatic/mcp) | 2.5.2 | 643 | `request.body` | POST: `reply.send`; GET SSE: hijack | Rejected | `mcpListToolNames()` (names only) | OAuth authn with global scopes |
| [`toolception`](https://www.npmjs.com/package/toolception) | 0.6.3 | 74 | `req.body` | Raw write | SDK v1: ≤100 | Internal | Per-client toolsets |

None of these authorizes individual tool calls. Their auth features stop at authentication, plus global scopes in platformatic's case.

### Findings

1. **Every transport dispatches Fastify's parsed `request.body`.** None of them re-reads `req.raw` when a body is present. SDK v2 re-serializes the parsed object rather than re-parsing bytes: `@modelcontextprotocol/node` `toWebRequest` only reads the stream if `parsedBody === undefined`. Platformatic does `const message = request.body` (`routes/mcp.js:222`). This confirms [threat model](../threat-model.md) assumption 5 and ADR-001's single-parse design.
2. **Most transports bypass `onSend`.** The SDK-based ones write straight to `reply.raw`, and `fastify-mcp-server` calls `reply.hijack()`. SSE is the SDK's default response mode. Only platformatic and getlarge return POST responses through `reply.send`. So filtering `tools/list` in an `onSend` hook, as ADR-001 anticipated, works for about 3% of the observed downloads.
3. **JSON-RPC batches are still live.** The MCP 2025-11-25 era, SDK v1 and the v2 legacy path accept batches of up to 100 messages. The 2026-07-28 revision rejects batches that contain requests. The interceptor must evaluate every element of an array body.
4. **There are two protocol eras at once.** `@modelcontextprotocol/server` 2.x serves both the 2025-era (initialize and sessions) and **2026-07-28**. The newer revision has no initialize and no sessions, and it carries `Mcp-Method` / `Mcp-Name` headers that the SDK cross-checks against the body (error `-32020`). Older transports don't cross-check, so **the guard must authorize from the body, never from those headers.**
5. **No transport exposes tool schemas publicly.** The guard needs the `{ name, inputSchema }` list to generate the Cedar schema and to filter `tools/list`. It will have to come from the user, from a wrapped server factory, or from a `tools/list` request the guard injects itself at startup.
6. **Hook placement: use `onRoute`.** An experiment with Fastify 5 gave the order *app-level hooks → route-level auth `preHandler` → guard*, when the guard adds itself to `routeOptions.preHandler` from an `onRoute` hook registered before the transport. The guard then runs after the transport's own auth has set `request.auth` or `request.tokenPayload`. An app-level `addHook('preHandler')` would run before route-level auth.

## 2. Overlapping MCP authorization projects

| Project | Downloads/wk | Stars | Model | Policy | Per-argument | `tools/list` filter | Approval | Separation of duties | Audit / OTel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`mcp-policy-guard`](https://www.npmjs.com/package/mcp-policy-guard) 0.2.0 | 1 | 0 | Wraps an MCP SDK v1 server's handlers | Glob rules (code or JSON) | Yes | Yes | Confirmation token; the **same caller** retries with the arguments | No (tokens bound to the requester by default) | Pino / no |
| [`@metamynd/agentsafe-mcp-guard`](https://www.npmjs.com/package/@metamynd/agentsafe-mcp-guard) 0.12.1 | 385 | 0 | Verifies signed requests | Vendor policy bundle | Payment fields | No | `escalate` throws | No | Partial |
| [`btp-guard`](https://www.npmjs.com/package/btp-guard) 5.4.16 | 558 | 1 | Regex denylist | None | Regex on the payload | No | No | No | Signed receipts |
| [`@auctra/mcp-gateway`](https://www.npmjs.com/package/@auctra/mcp-gateway) 0.1.9 | 55 | n/a | SaaS client | Decided in the vendor's cloud | Decided in the vendor's cloud | No | `require_approval` throws | Unverified | Decided in the vendor's cloud |
| [`@strixgov/tool-gateway`](https://www.npmjs.com/package/@strixgov/tool-gateway) 0.5.0 | 269 | 0 | Gateway | Per capability | No | No | Blocks inline, 60 s timeout, then denies | Not enforced | Receipts |
| [`mcp-approval`](https://www.npmjs.com/package/mcp-approval) 0.8.2 | 660 | n/a | Helper called inside each handler | None | Per handler | No | Elicitation to the same user | No | No |
| [agentgateway](https://github.com/agentgateway/agentgateway) | n/a | ~5k | Rust proxy | CEL-based RBAC | Likely (unverified) | Unverified | None found | No | Yes / yes |

**Verdict: the pivot is not triggered.**
- `mcp-policy-guard` is the closest match. It already covers per-argument rules, `tools/list` filtering, a confirmation gate and Pino audit, so those features are not what sets this project apart.
- No project combines the following, which is what does set it apart:
  1. **Park and replay:** the stored original call is hash-checked and replayed by the server, so the agent never re-sends the arguments. Every approval flow above either has the agent retry or blocks the request inline.
  2. **Enforced separation of duties:** the approver must be a different, verified principal.
  3. **Cedar with a three-way outcome** (allow, deny, require approval), in a policy language that can be analyzed and that compliance staff can read.
  4. **Fastify-native:** works from the verified OAuth principal, with OpenTelemetry spans.
- Worth borrowing from `mcp-policy-guard`:
  - A condition that throws counts as not matching.
  - Rules that depend on arguments keep their tool listed and are enforced at call time.
  - Argument hashing that doesn't depend on key order.

## 3. Cedar building blocks

- **[`@cedar-policy/mcp-schema-generator-wasm`](https://www.npmjs.com/package/@cedar-policy/mcp-schema-generator-wasm) 0.6.1** (Apache-2.0, part of [cedar-for-agents](https://github.com/cedar-policy/cedar-for-agents)).
  - **What it does:** turns a `tools/list` result plus a schema stub into a Cedar schema. Each tool becomes an action whose `context.input` is typed from the tool's `inputSchema`.
  - **It replaces most of #19.** A small glue layer is still needed:
    - `objectsAsRecords: true`, so nested objects aren't turned into entities with UUIDs.
    - We build the `context` ourselves; `generateRequest` doesn't return it.
    - **Tool names containing `.` or `-` fail** (`fs.read`, `create-issue`) and need sanitizing. A good upstream contribution.
- **[`@cedar-policy/cedar-wasm`](https://www.npmjs.com/package/@cedar-policy/cedar-wasm) 4.13.0**: use it directly. **Don't use** `@cedar-policy/cedar-authorization`: its deny result has no determining policies, so it can't tell deny from require-approval.
- **Evaluation doesn't return annotations** (affects #21).
  - `isAuthorized` returns `{ decision, diagnostics: { reason: PolicyId[], errors } }`, and text policy sets get automatic IDs (`policy0`, …).
  - A working approach, tested:
    1. Split the text with `policySetTextToParts`.
    2. Read `@id` / `@outcome` with `policyToJson(p).json.annotations`.
    3. Pass `staticPolicies` keyed by `@id`, so `reason` returns those IDs.
    4. Classify the outcome from `reason`.
- **Fail closed on evaluation errors.** Cedar skips policies that error. If a hard-deny `forbid` errors, an approval `forbid` could become the only one that decides the outcome, which would turn a deny into require-approval. Any non-empty `diagnostics.errors` must produce a deny.

## 4. Input for other issues

| Issue | Finding |
| --- | --- |
| #10 JSON-RPC parser | Iterate array bodies (≤100). Reject string or Buffer bodies (fail closed). Use the body, not the `Mcp-Method`/`Mcp-Name` headers. Handle both protocol eras. |
| #11 hook | Attach via `onRoute` to `routeOptions.preHandler`, so the guard runs after route-level auth. |
| #12 principal | Default resolvers for `request.auth` (SDK v2, fastify-mcp-server) and `request.tokenPayload` (platformatic). |
| #17 require_approval surface | Consider MCP **Tasks**: a `tools/call` with task augmentation returns a task whose status (`working`, `input_required`, `completed`, …) the client polls. This maps naturally onto park → approve → replay. It is supported by clients that implement Tasks (experimental in 2025-11-25). |
| #19 schema generator | Reuse `@cedar-policy/mcp-schema-generator-wasm` with the glue above. |
| #20 / #21 Cedar adapter | Use `cedar-wasm` directly, with policies keyed by `@id`. Classify outcomes from `diagnostics.reason`, and deny on any `diagnostics.errors`. |
| #22 `tools/list` filtering | `onSend` works only for platformatic and getlarge. For SDK-based transports, filter at the MCP layer by wrapping the server factory or the `tools/list` handler. |

## Not verified

- Whether agentgateway filters `tools/list`, and the details of its per-argument CEL rules.
- Auctra's source repo and tests.
- Whether `isAuthorizedPartial` can drive `tools/list` filtering when rules depend on arguments.
- Star and download counts are snapshots from the survey date.
