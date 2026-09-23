# fastify-mcp-guard

> 🚧 Work in progress: targeting v0.1.0 in November 2026.

A Fastify plugin that authorizes MCP tool calls. For each `tools/call` it decides whether an agent may act (**allow**, **deny**, or **hold for human approval**) and audits every decision.

MCP standardizes authentication (OAuth 2.1) but not authorization. `fastify-mcp-guard` adds per-tool, per-argument policy written in [Cedar](https://www.cedarpolicy.com/), approval gates with a tamper-proof replay, and structured audit events via Pino and OpenTelemetry.

```ts
await fastify.register(mcpGuard, {
  route: '/mcp',
  principal: (req) => ({ id: req.user.sub, scopes: req.user.scope }),
  engine: cedarEngine({ policies: './policies/*.cedar', schema: './policies/schema.json' }),
  approvals: { store: memoryStore(), ttl: '15m' },
  filterToolList: true
})
```

This API is a draft. Progress is tracked in the [milestones](https://github.com/bdot-real/fastify-mcp-guard/milestones).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Report security issues as described in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
