import { mcpGuard } from './plugin.ts'

export { mcpGuard }
export type { McpGuardOptions } from './plugin.ts'
export type { McpGuardRequestState } from './hook.ts'
export type { ClassifiedMessage, JsonRpcId } from './jsonrpc.ts'
export { INVALID_REQUEST, POLICY_DENIED } from './errors.ts'

export default mcpGuard
