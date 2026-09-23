import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import mcpGuard, { mcpGuard as namedExport } from '../src/index.ts'

test('default and named exports are the same plugin', () => {
  assert.equal(mcpGuard, namedExport)
})

test('registers on a Fastify instance under its plugin name', async (t) => {
  const app = Fastify()
  t.after(() => app.close())

  await app.register(mcpGuard, { route: '/mcp' })
  await app.ready()

  assert.ok(app.hasPlugin('fastify-mcp-guard'))
})

test('registers without options', async (t) => {
  const app = Fastify()
  t.after(() => app.close())

  await app.register(mcpGuard)
  await app.ready()

  assert.ok(app.hasPlugin('fastify-mcp-guard'))
})
