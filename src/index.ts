import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

/**
 * Options for the `fastify-mcp-guard` plugin.
 *
 * Draft: the full option set (principal resolver, policy engine, approvals,
 * audit) lands with the M1–M4 milestones.
 */
export interface McpGuardOptions {
  /** Path of the MCP Streamable HTTP route to guard. Defaults to `/mcp`. */
  route?: string
}

const plugin: FastifyPluginAsync<McpGuardOptions> = async () => {
  // Interception is implemented in M1 (#10, #11).
}

/** Fastify plugin that authorizes MCP tool calls. */
export const mcpGuard = fp(plugin, {
  fastify: '5.x',
  name: 'fastify-mcp-guard'
})

export default mcpGuard
