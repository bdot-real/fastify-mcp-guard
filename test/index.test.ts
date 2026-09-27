import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import mcpGuard, { INVALID_REQUEST, POLICY_DENIED, mcpGuard as namedExport } from '../src/index.ts'

test('default and named exports are the same plugin', () => {
  assert.equal(mcpGuard, namedExport)
})

test('exports stable JSON-RPC error codes', () => {
  assert.equal(INVALID_REQUEST, -32600)
  assert.equal(POLICY_DENIED, -32001)
})

test('registers on a Fastify instance under its plugin name', async (t) => {
  const app = Fastify()
  t.after(() => app.close())

  await app.register(mcpGuard)
  app.post('/mcp', async () => ({}))
  await app.ready()

  assert.ok(app.hasPlugin('fastify-mcp-guard'))
})
