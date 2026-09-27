import type { FastifyPluginAsync, RouteOptions } from 'fastify'
import fp from 'fastify-plugin'
import { createGuardHook, type McpGuardRequestState } from './hook.ts'
import { DEFAULT_MAX_BATCH_SIZE } from './jsonrpc.ts'

/**
 * Options for the `fastify-mcp-guard` plugin.
 *
 * Draft: the principal resolver, policy engine, approvals and audit
 * options land with the M1–M4 milestones.
 */
export interface McpGuardOptions {
  /** Full path (including any prefix) of the MCP Streamable HTTP route to guard. Defaults to `/mcp`. */
  route?: string
  /** Maximum JSON-RPC messages accepted in one batch. Defaults to 100. */
  maxBatchSize?: number
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Parsed JSON-RPC messages for requests on the guarded route; `null` elsewhere. */
    mcpGuard: McpGuardRequestState | null
  }
}

const plugin: FastifyPluginAsync<McpGuardOptions> = async (fastify, options) => {
  const route = options.route ?? '/mcp'
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE

  if (typeof route !== 'string' || !route.startsWith('/')) {
    throw new TypeError('fastify-mcp-guard: `route` must be a path starting with "/"')
  }
  if (!Number.isSafeInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new TypeError('fastify-mcp-guard: `maxBatchSize` must be a positive integer')
  }

  const guard = createGuardHook({ maxBatchSize })
  let guardedRoutes = 0

  fastify.decorateRequest('mcpGuard', null)

  // onRoute (not an app-level preHandler) so the guard runs after the
  // transport's own route-level auth hooks (ADR-007).
  fastify.addHook('onRoute', (routeOptions: RouteOptions) => {
    if (routeOptions.url !== route || !acceptsPost(routeOptions.method)) {
      return
    }
    const existing = routeOptions.preHandler
    routeOptions.preHandler = existing === undefined
      ? [guard]
      : [...(Array.isArray(existing) ? existing : [existing]), guard]
    guardedRoutes++
  })

  // onRoute only sees routes added after this plugin. If the MCP route was
  // registered first it would be silently unguarded (threat model E1).
  fastify.addHook('onReady', async () => {
    if (guardedRoutes === 0) {
      throw new Error(
        `fastify-mcp-guard: no POST route matched "${route}". ` +
        'Register mcpGuard before the MCP transport, in the same or a parent context, ' +
        'and set `route` to the full path including any prefix.'
      )
    }
  })
}

function acceptsPost (method: RouteOptions['method']): boolean {
  return Array.isArray(method) ? method.includes('POST') : method === 'POST'
}

/** Fastify plugin that authorizes MCP tool calls. */
export const mcpGuard = fp(plugin, {
  fastify: '5.x',
  name: 'fastify-mcp-guard'
})
