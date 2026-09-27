import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import { invalidRequest, policyDenied, type JsonRpcError } from './errors.ts'
import { parseJsonRpcBody, type ClassifiedMessage, type InvalidMessage } from './jsonrpc.ts'

export interface McpGuardRequestState {
  batch: boolean
  messages: ClassifiedMessage[]
}

export interface GuardHookOptions {
  maxBatchSize: number
}

/**
 * The guard's `preHandler`, attached only to the configured MCP route.
 *
 * Only POST carries JSON-RPC requests; GET (SSE stream) and DELETE
 * (session end) on the same route pass through untouched.
 */
export function createGuardHook (options: GuardHookOptions): preHandlerAsyncHookHandler {
  return async function mcpGuardPreHandler (request: FastifyRequest, reply: FastifyReply) {
    if (request.method !== 'POST') {
      return
    }

    const parsed = parseJsonRpcBody(request.body, { maxBatchSize: options.maxBatchSize })
    if (!parsed.ok) {
      request.log.debug({ reason: parsed.reason }, 'mcp-guard: rejected unusable body')
      return reply.code(400).send(invalidRequest(null))
    }

    const { batch, messages } = parsed
    request.mcpGuard = { batch, messages }

    const firstInvalid = messages.find((m): m is InvalidMessage => m.kind === 'invalid')
    if (firstInvalid !== undefined) {
      request.log.debug({ index: firstInvalid.index, reason: firstInvalid.reason }, 'mcp-guard: rejected invalid message')
      return reply.code(400).send(batch ? invalidRequest(null) : invalidRequest(firstInvalid.id ?? null))
    }

    // Default deny (ADR-003): until the policy engine lands (#13), every
    // tool call is refused. tools/list and other methods do not run tools
    // and pass through (filtering is #22; other methods are threat model E8).
    if (!messages.some(m => m.kind === 'tools/call')) {
      return
    }

    // A batch is never rewritten to drop denied entries: the guard and the
    // transport must see the same body (threat model T3). If any entry is
    // denied, the whole batch is rejected with one error per request id.
    const errors: JsonRpcError[] = messages.flatMap(m => m.id === undefined ? [] : [policyDenied(m.id)])
    if (errors.length === 0) {
      // Notifications only: Streamable HTTP requires an HTTP error status
      // and allows an error body without an id.
      return reply.code(403).send(policyDenied(null))
    }
    return reply.code(200).send(batch ? errors : errors[0])
  }
}
