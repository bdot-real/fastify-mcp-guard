import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { type FastifyInstance, type FastifyPluginAsync, type preHandlerAsyncHookHandler } from 'fastify'
import fp from 'fastify-plugin'
import { mcpGuard, type McpGuardOptions } from '../src/plugin.ts'
import { INVALID_REQUEST, POLICY_DENIED } from '../src/errors.ts'

const toolCall = (id: number, name = 'initiate_credit_transfer') =>
  ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { amount: 1 } } })
const toolList = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/list' })

/** Stand-in transport: records what reached the handler and echoes it. */
function transport (url = '/mcp', methods: string[] = ['POST']): FastifyPluginAsync {
  return async (app) => {
    app.route({
      method: methods,
      url,
      handler: async (request) => ({ reached: true, method: request.method, body: request.body ?? null })
    })
  }
}

async function build (t: { after: (fn: () => unknown) => void }, options: McpGuardOptions = {}, setup?: (app: FastifyInstance) => void | Promise<void>) {
  const app = Fastify()
  t.after(() => app.close())
  await app.register(mcpGuard, options)
  if (setup) {
    await setup(app)
  } else {
    await app.register(transport())
  }
  await app.ready()
  return app
}

const post = (app: FastifyInstance, payload: unknown, url = '/mcp') =>
  app.inject({ method: 'POST', url, payload: payload as object })

describe('enforcement on the guarded route', () => {
  test('denies tools/call by default with -32001 and does not reach the handler', async (t) => {
    const app = await build(t)
    const response = await post(app, toolCall(1))
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), {
      jsonrpc: '2.0', id: 1, error: { code: POLICY_DENIED, message: 'Denied by policy', data: { outcome: 'deny' } }
    })
  })

  test('passes tools/list and other methods through', async (t) => {
    const app = await build(t)
    for (const body of [toolList(1), { jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }, { jsonrpc: '2.0', method: 'notifications/initialized' }]) {
      const response = await post(app, body)
      assert.equal(response.json().reached, true, JSON.stringify(body))
    }
  })

  test('exposes the parsed messages on request.mcpGuard', async (t) => {
    const app = await build(t, {}, (app) => {
      app.post('/mcp', async (request) => request.mcpGuard)
      app.get('/other', async (request) => ({ state: request.mcpGuard }))
    })
    assert.deepEqual((await post(app, toolList(5))).json(), {
      batch: false, messages: [{ kind: 'tools/list', index: 0, id: 5 }]
    })
    assert.deepEqual((await app.inject({ method: 'GET', url: '/other' })).json(), { state: null })
  })

  test('rejects an unusable body with 400 -32600 and a null id', async (t) => {
    const app = await build(t)
    for (const payload of ['[]', '"just a string"', '42']) {
      const response = await app.inject({ method: 'POST', url: '/mcp', headers: { 'content-type': 'application/json' }, payload })
      assert.equal(response.statusCode, 400, payload)
      assert.deepEqual(response.json(), { jsonrpc: '2.0', id: null, error: { code: INVALID_REQUEST, message: 'Invalid Request' } })
    }
  })

  test('rejects an invalid single message with its id', async (t) => {
    const app = await build(t)
    const response = await post(app, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: '' } })
    assert.equal(response.statusCode, 400)
    assert.equal(response.json().id, 4)
    assert.equal(response.json().error.code, INVALID_REQUEST)
  })

  test('rejects an invalid message without a usable id with a null id', async (t) => {
    const app = await build(t)
    const response = await post(app, { jsonrpc: '2.0', id: null, method: 'tools/list' })
    assert.equal(response.statusCode, 400)
    assert.equal(response.json().id, null)
  })

  test('honours maxBatchSize', async (t) => {
    const app = await build(t, { maxBatchSize: 2 })
    assert.equal((await post(app, [toolList(1), toolList(2)])).json().reached, true)
    assert.equal((await post(app, [toolList(1), toolList(2), toolList(3)])).statusCode, 400)
  })
})

describe('batches (threat model T2, T3)', () => {
  test('a batch containing a tool call is rejected whole, one error per request id', async (t) => {
    const app = await build(t)
    const response = await post(app, [toolList(1), toolCall(2), { jsonrpc: '2.0', method: 'notifications/initialized' }])
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().map((e: { id: number, error: { code: number } }) => [e.id, e.error.code]), [
      [1, POLICY_DENIED],
      [2, POLICY_DENIED]
    ])
  })

  test('tool-call notifications only: 403 with a single null-id error', async (t) => {
    const app = await build(t)
    const notification = { jsonrpc: '2.0', method: 'tools/call', params: { name: 't' } }
    for (const body of [notification, [notification, notification]]) {
      const response = await post(app, body)
      assert.equal(response.statusCode, 403)
      assert.deepEqual(response.json(), {
        jsonrpc: '2.0', id: null, error: { code: POLICY_DENIED, message: 'Denied by policy', data: { outcome: 'deny' } }
      })
    }
  })

  test('a mixed batch answers only the requests, with 200', async (t) => {
    const app = await build(t)
    const response = await post(app, [{ jsonrpc: '2.0', method: 'tools/call', params: { name: 't' } }, toolCall(9)])
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), [{
      jsonrpc: '2.0', id: 9, error: { code: POLICY_DENIED, message: 'Denied by policy', data: { outcome: 'deny' } }
    }])
  })

  test('a batch with an invalid entry is rejected with 400 and a null id', async (t) => {
    const app = await build(t)
    const response = await post(app, [toolList(1), { jsonrpc: '2.0', id: 2 }])
    assert.equal(response.statusCode, 400)
    assert.deepEqual(response.json(), { jsonrpc: '2.0', id: null, error: { code: INVALID_REQUEST, message: 'Invalid Request' } })
  })

  test('a batch without tool calls passes through unmodified', async (t) => {
    const app = await build(t)
    const body = [toolList(1), toolList(2)]
    assert.deepEqual((await post(app, body)).json(), { reached: true, method: 'POST', body })
  })
})

describe('route matching', () => {
  test('GET and DELETE on the same route pass through (SSE stream, session end)', async (t) => {
    const app = await build(t, {}, async (app) => { await app.register(transport('/mcp', ['GET', 'POST', 'DELETE'])) })
    for (const method of ['GET', 'DELETE'] as const) {
      const response = await app.inject({ method, url: '/mcp' })
      assert.deepEqual(response.json(), { reached: true, method, body: null })
    }
    assert.equal((await post(app, toolCall(1))).json().error.code, POLICY_DENIED)
  })

  test('guards routes registered with fastify.all', async (t) => {
    const app = await build(t, {}, (app) => { app.all('/mcp', async (request) => ({ reached: true, method: request.method })) })
    assert.equal((await post(app, toolCall(1))).json().error.code, POLICY_DENIED)
    assert.equal((await app.inject({ method: 'GET', url: '/mcp' })).json().reached, true)
  })

  test('guards routes declared with a lowercase method', async (t) => {
    const app = await build(t, {}, (app) => { app.route({ method: 'post' as 'POST', url: '/mcp', handler: async () => ({ reached: true }) }) })
    assert.equal((await post(app, toolCall(1))).json().error.code, POLICY_DENIED)
  })

  test('leaves other routes alone, including POST on other paths', async (t) => {
    const app = await build(t, {}, async (app) => {
      await app.register(transport())
      app.post('/not-mcp', async () => ({ reached: true }))
    })
    assert.equal((await post(app, toolCall(1), '/not-mcp')).json().reached, true)
  })

  test('a GET-only route with the same path is not guarded and does not count as a match', async (t) => {
    const app = Fastify()
    t.after(() => app.close())
    await app.register(mcpGuard)
    app.get('/mcp', async () => ({}))
    await assert.rejects(async () => { await app.ready() }, /no POST route matched "\/mcp"/)
  })

  test('a custom route under a prefix, from an encapsulated (non-fp) transport plugin', async (t) => {
    const app = await build(t, { route: '/v1/agents/mcp' }, async (app) => {
      await app.register(transport('/agents/mcp'), { prefix: '/v1' })
    })
    assert.equal((await post(app, toolCall(1), '/v1/agents/mcp')).json().error.code, POLICY_DENIED)
  })

  test('a transport wrapped in fastify-plugin', async (t) => {
    const app = await build(t, {}, async (app) => { await app.register(fp(transport())) })
    assert.equal((await post(app, toolCall(1))).json().error.code, POLICY_DENIED)
  })
})

describe('hook ordering', () => {
  const order = (name: string, log: string[]): preHandlerAsyncHookHandler => async () => { log.push(name) }

  for (const [label, preHandler] of [
    ['a single function', (log: string[]) => order('route-auth', log)],
    ['an array', (log: string[]) => [order('route-auth', log), order('route-extra', log)]]
  ] as const) {
    test(`runs after existing route preHandlers given as ${label}`, async (t) => {
      const log: string[] = []
      const app = await build(t, {}, (app) => {
        app.addHook('preHandler', order('app-level', log))
        app.addHook('preHandler', async (request) => { if (request.mcpGuard !== null) log.push('guard') })
        app.post('/mcp', { preHandler: preHandler(log) }, async (request) => {
          if (request.mcpGuard !== null) log.push('guard-ran')
          return {}
        })
      })
      await post(app, toolList(1))
      assert.deepEqual(log.filter(e => e !== 'guard'), ['app-level', ...(label === 'an array' ? ['route-auth', 'route-extra'] : ['route-auth']), 'guard-ran'])
      assert.ok(!log.includes('guard'), 'guard must not run before app-level hooks')
    })
  }

  test('a route-level auth rejection short-circuits before the guard', async (t) => {
    const app = await build(t, {}, (app) => {
      app.post('/mcp', {
        preHandler: async (_request, reply) => reply.code(401).send({ error: 'unauthorized' })
      }, async () => ({ reached: true }))
    })
    const response = await post(app, toolCall(1))
    assert.equal(response.statusCode, 401)
  })
})

describe('startup checks (threat model E1)', () => {
  test('fails ready() when the route was registered before the guard', async (t) => {
    const app = Fastify()
    t.after(() => app.close())
    app.post('/mcp', async () => ({}))
    await app.register(mcpGuard)
    await assert.rejects(async () => { await app.ready() }, /Register mcpGuard before the MCP transport/)
  })

  test('fails ready() when the route lives in a sibling context', async (t) => {
    const app = Fastify()
    t.after(() => app.close())
    await app.register(async (child) => { await child.register(mcpGuard) })
    await app.register(transport())
    await assert.rejects(async () => { await app.ready() }, /no POST route matched/)
  })

  test('fails ready() when the prefix is left out of route', async (t) => {
    const app = Fastify()
    t.after(() => app.close())
    await app.register(mcpGuard, { route: '/mcp' })
    await app.register(transport(), { prefix: '/v1' })
    await assert.rejects(async () => { await app.ready() }, /including any prefix/)
  })
})

describe('option validation', () => {
  for (const [name, options, message] of [
    ['route without a leading slash', { route: 'mcp' }, /`route` must be a path/],
    ['non-string route', { route: 42 }, /`route` must be a path/],
    ['zero maxBatchSize', { maxBatchSize: 0 }, /`maxBatchSize` must be a positive integer/],
    ['fractional maxBatchSize', { maxBatchSize: 1.5 }, /`maxBatchSize` must be a positive integer/]
  ] as const) {
    test(`rejects ${name}`, async (t) => {
      const app = Fastify()
      t.after(() => app.close())
      await assert.rejects(async () => app.register(mcpGuard, options as unknown as McpGuardOptions), message)
    })
  }
})
