import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { DEFAULT_MAX_BATCH_SIZE, parseJsonRpcBody } from '../src/jsonrpc.ts'

const call = (id: unknown, name: unknown, args?: unknown) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: args === undefined ? { name } : { name, arguments: args }
})

function single (body: unknown) {
  const result = parseJsonRpcBody(body)
  assert.ok(result.ok, 'expected body to parse')
  assert.equal(result.batch, false)
  assert.equal(result.messages.length, 1)
  return result.messages[0]
}

describe('single messages', () => {
  test('tools/call with arguments', () => {
    assert.deepEqual(single(call(1, 'initiate_credit_transfer', { amount: 25000, currency: 'CAD' })), {
      kind: 'tools/call',
      index: 0,
      id: 1,
      tool: 'initiate_credit_transfer',
      args: { amount: 25000, currency: 'CAD' }
    })
  })

  test('tools/call without arguments defaults to an empty object', () => {
    assert.deepEqual(single(call('a', 'get_balances')), {
      kind: 'tools/call', index: 0, id: 'a', tool: 'get_balances', args: {}
    })
  })

  test('tools/call with explicit undefined arguments defaults to an empty object', () => {
    const message = single({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 't', arguments: undefined } })
    assert.equal(message?.kind, 'tools/call')
    assert.deepEqual(message.kind === 'tools/call' && message.args, {})
  })

  test('tools/call sent as a notification is still a tool call', () => {
    const message = single({ jsonrpc: '2.0', method: 'tools/call', params: { name: 't' } })
    assert.equal(message?.kind, 'tools/call')
    assert.equal(message.id, undefined)
  })

  test('tools/list', () => {
    assert.deepEqual(single({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), {
      kind: 'tools/list', index: 0, id: 2
    })
  })

  test('other requests and notifications pass through as other', () => {
    assert.deepEqual(single({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} }), {
      kind: 'other', index: 0, id: 3, method: 'initialize'
    })
    assert.deepEqual(single({ jsonrpc: '2.0', method: 'notifications/initialized' }), {
      kind: 'other', index: 0, id: undefined, method: 'notifications/initialized'
    })
  })

  test('client responses to server requests', () => {
    assert.deepEqual(single({ jsonrpc: '2.0', id: 7, result: {} }), { kind: 'response', index: 0, id: 7 })
    assert.deepEqual(single({ jsonrpc: '2.0', id: 8, error: { code: -1, message: 'no' } }), {
      kind: 'response', index: 0, id: 8
    })
  })

  test('method matching is exact and case-sensitive (T5)', () => {
    for (const method of ['Tools/Call', 'tools/call ', 'tools/call​', 'tools\\call']) {
      const message = single({ jsonrpc: '2.0', id: 1, method, params: { name: 't' } })
      assert.deepEqual(message, { kind: 'other', index: 0, id: 1, method })
    }
  })
})

describe('invalid messages', () => {
  const cases: Array<[string, unknown, string]> = [
    ['wrong jsonrpc version', { jsonrpc: '1.0', id: 1, method: 'tools/list' }, 'jsonrpc must be "2.0"'],
    ['missing jsonrpc', { id: 1, method: 'tools/list' }, 'jsonrpc must be "2.0"'],
    ['null id', { jsonrpc: '2.0', id: null, method: 'tools/list' }, 'id must be a string or an integer'],
    ['fractional id', { jsonrpc: '2.0', id: 1.5, method: 'tools/list' }, 'id must be a string or an integer'],
    ['object id', { jsonrpc: '2.0', id: {}, method: 'tools/list' }, 'id must be a string or an integer'],
    ['no method and no result', { jsonrpc: '2.0', id: 1 }, 'message has no method'],
    ['result without id', { jsonrpc: '2.0', result: {} }, 'message has no method'],
    ['non-string method', { jsonrpc: '2.0', id: 1, method: 42 }, 'method must be a string'],
    ['tools/call without params', { jsonrpc: '2.0', id: 1, method: 'tools/call' }, 'tools/call params must be an object'],
    ['tools/call with array params', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: ['t'] }, 'tools/call params must be an object'],
    ['tools/call without name', call(1, undefined), 'tools/call params.name must be a non-empty string'],
    ['tools/call with empty name', call(1, ''), 'tools/call params.name must be a non-empty string'],
    ['tools/call with non-string name', call(1, 7), 'tools/call params.name must be a non-empty string'],
    ['tools/call with array arguments', call(1, 't', [1]), 'tools/call params.arguments must be an object'],
    ['tools/call with null arguments', call(1, 't', null), 'tools/call params.arguments must be an object'],
    ['tools/call with string arguments', call(1, 't', '{}'), 'tools/call params.arguments must be an object']
  ]

  for (const [name, body, reason] of cases) {
    test(name, () => {
      const message = single(body)
      assert.equal(message?.kind, 'invalid')
      assert.equal(message.kind === 'invalid' && message.reason, reason)
    })
  }

  test('keeps a valid id on invalid messages so the error can be correlated', () => {
    assert.equal(single(call(9, ''))?.id, 9)
  })

  test('drops an invalid id', () => {
    assert.equal(single({ jsonrpc: '2.0', id: null, method: 'x' })?.id, undefined)
  })

  test('arguments with a non-plain prototype are rejected', () => {
    const message = single(call(1, 't', new Map()))
    assert.equal(message?.kind, 'invalid')
  })

  test('objects with a null prototype are accepted', () => {
    const args = Object.assign(Object.create(null), { a: 1 })
    const message = single(call(1, 't', args))
    assert.equal(message?.kind, 'tools/call')
  })
})

describe('batches (T2)', () => {
  test('classifies every message independently, keeping positions', () => {
    const result = parseJsonRpcBody([
      call(1, 'get_balances'),
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      call(3, 'initiate_credit_transfer', { amount: 1 }),
      'garbage',
      { jsonrpc: '2.0', method: 'notifications/initialized' }
    ])
    assert.ok(result.ok)
    assert.equal(result.batch, true)
    assert.deepEqual(result.messages.map(m => [m.index, m.kind]), [
      [0, 'tools/call'],
      [1, 'tools/list'],
      [2, 'tools/call'],
      [3, 'invalid'],
      [4, 'other']
    ])
  })

  test('a single-element batch is still a batch', () => {
    const result = parseJsonRpcBody([call(1, 't')])
    assert.ok(result.ok)
    assert.equal(result.batch, true)
  })

  test('rejects an empty batch', () => {
    assert.deepEqual(parseJsonRpcBody([]), { ok: false, reason: 'empty batch' })
  })

  test(`accepts up to ${DEFAULT_MAX_BATCH_SIZE} messages by default and rejects more`, () => {
    const batch = Array.from({ length: DEFAULT_MAX_BATCH_SIZE }, (_, i) => call(i, 't'))
    assert.equal(parseJsonRpcBody(batch).ok, true)
    assert.deepEqual(parseJsonRpcBody([...batch, call(100, 't')]), {
      ok: false, reason: 'batch exceeds 100 messages'
    })
  })

  test('honours a custom maximum batch size', () => {
    assert.deepEqual(parseJsonRpcBody([call(1, 't'), call(2, 't')], { maxBatchSize: 1 }), {
      ok: false, reason: 'batch exceeds 1 messages'
    })
  })
})

describe('unusable bodies fail closed (T3)', () => {
  const bodies: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['a string', JSON.stringify(call(1, 't'))],
    ['a Buffer', Buffer.from(JSON.stringify(call(1, 't')))],
    ['a number', 42],
    ['a class instance', new (class Body { jsonrpc = '2.0' })()]
  ]

  for (const [name, body] of bodies) {
    test(name, () => {
      assert.deepEqual(parseJsonRpcBody(body), { ok: false, reason: 'body is not a JSON object or array' })
    })
  }
})

describe('Fastify body parsing in front of the parser (T4)', () => {
  async function post (payload: string) {
    const app = Fastify()
    app.post('/mcp', async (request) => parseJsonRpcBody(request.body))
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload
    })
    await app.close()
    return response
  }

  test('rejects __proto__ poisoning before any hook or handler runs', async () => {
    const response = await post('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"t","arguments":{"__proto__":{"isAdmin":true}}}}')
    assert.equal(response.statusCode, 400)
  })

  test('rejects constructor.prototype poisoning', async () => {
    const response = await post('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"t","arguments":{"constructor":{"prototype":{"isAdmin":true}}}}}')
    assert.equal(response.statusCode, 400)
  })

  test('with duplicate keys, the parser sees the same last-wins value the transport will', async () => {
    const response = await post('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"safe_tool","name":"dangerous_tool"}}')
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().messages[0].tool, 'dangerous_tool')
  })
})
