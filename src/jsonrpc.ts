/**
 * Classifies the JSON-RPC payload of an MCP Streamable HTTP request.
 *
 * Works on the body Fastify has already parsed (ADR-001); it never reads
 * or re-parses the raw request. Everything here is attacker-controlled
 * (threat model TB1), so the parser is strict and anything it cannot
 * classify with certainty is reported as invalid for the guard to deny.
 */

/** MCP allows up to 100 messages per batch on the 2025-era transports. */
export const DEFAULT_MAX_BATCH_SIZE = 100

export type JsonRpcId = string | number

interface MessageBase {
  /** Position in the batch, or 0 for a single message. */
  index: number
  /** Request id; `undefined` for notifications. */
  id: JsonRpcId | undefined
}

export interface ToolCallMessage extends MessageBase {
  kind: 'tools/call'
  tool: string
  args: Record<string, unknown>
}

export interface ToolListMessage extends MessageBase {
  kind: 'tools/list'
}

/** Any other request or notification; not guarded in v0.1 (threat model E8). */
export interface OtherMessage extends MessageBase {
  kind: 'other'
  method: string
}

/** A client's response to a server-initiated request (e.g. elicitation). */
export interface ResponseMessage extends MessageBase {
  kind: 'response'
}

export interface InvalidMessage extends MessageBase {
  kind: 'invalid'
  reason: string
}

export type ClassifiedMessage =
  | ToolCallMessage
  | ToolListMessage
  | OtherMessage
  | ResponseMessage
  | InvalidMessage

export type ParseResult =
  | { ok: true, batch: boolean, messages: ClassifiedMessage[] }
  | { ok: false, reason: string }

export interface ParseOptions {
  maxBatchSize?: number
}

/**
 * Classify a parsed request body.
 *
 * Returns `ok: false` when the body as a whole is unusable (not a JSON
 * object or array, empty or oversized batch). Otherwise returns one
 * classified entry per message; individual messages may be `invalid`.
 */
export function parseJsonRpcBody (body: unknown, options: ParseOptions = {}): ParseResult {
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE

  if (Array.isArray(body)) {
    if (body.length === 0) {
      return { ok: false, reason: 'empty batch' }
    }
    if (body.length > maxBatchSize) {
      return { ok: false, reason: `batch exceeds ${maxBatchSize} messages` }
    }
    const messages = new Array<ClassifiedMessage>(body.length)
    for (let i = 0; i < body.length; i++) {
      messages[i] = classifyMessage(body[i], i)
    }
    return { ok: true, batch: true, messages }
  }

  // Strings and Buffers mean a custom content-type parser handed us bytes
  // the transport may parse differently (threat model T3): fail closed.
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'body is not a JSON object or array' }
  }

  return { ok: true, batch: false, messages: [classifyMessage(body, 0)] }
}

function classifyMessage (message: unknown, index: number): ClassifiedMessage {
  if (!isPlainObject(message)) {
    return invalid(index, undefined, 'message is not an object')
  }

  const hasId = Object.hasOwn(message, 'id')
  const id = message.id
  if (hasId && !isValidId(id)) {
    return invalid(index, undefined, 'id must be a string or an integer')
  }
  const validId = hasId ? id as JsonRpcId : undefined

  if (message.jsonrpc !== '2.0') {
    return invalid(index, validId, 'jsonrpc must be "2.0"')
  }

  if (!Object.hasOwn(message, 'method')) {
    if (hasId && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) {
      return { kind: 'response', index, id: validId }
    }
    return invalid(index, validId, 'message has no method')
  }

  const method = message.method
  if (typeof method !== 'string') {
    return invalid(index, validId, 'method must be a string')
  }

  // Exact, case-sensitive match (threat model T5). A tools/call sent as a
  // notification (no id) is still classified as a tool call so that it is
  // evaluated rather than passed through.
  if (method === 'tools/call') {
    return classifyToolCall(message, index, validId)
  }
  if (method === 'tools/list') {
    return { kind: 'tools/list', index, id: validId }
  }
  return { kind: 'other', index, id: validId, method }
}

function classifyToolCall (
  message: Record<string, unknown>,
  index: number,
  id: JsonRpcId | undefined
): ToolCallMessage | InvalidMessage {
  const params = message.params
  if (!isPlainObject(params)) {
    return invalid(index, id, 'tools/call params must be an object')
  }

  const tool = params.name
  if (typeof tool !== 'string' || tool.length === 0) {
    return invalid(index, id, 'tools/call params.name must be a non-empty string')
  }

  let args: Record<string, unknown> = {}
  if (Object.hasOwn(params, 'arguments') && params.arguments !== undefined) {
    if (!isPlainObject(params.arguments)) {
      return invalid(index, id, 'tools/call params.arguments must be an object')
    }
    args = params.arguments
  }

  return { kind: 'tools/call', index, id, tool, args }
}

function invalid (index: number, id: JsonRpcId | undefined, reason: string): InvalidMessage {
  return { kind: 'invalid', index, id, reason }
}

function isValidId (id: unknown): id is JsonRpcId {
  // MCP forbids null ids; JSON-RPC discourages fractional numbers.
  return typeof id === 'string' || Number.isSafeInteger(id)
}

function isPlainObject (value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
