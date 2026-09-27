import type { JsonRpcId } from './jsonrpc.ts'

/** JSON-RPC 2.0: the payload is not a valid request object. */
export const INVALID_REQUEST = -32600

/**
 * The call was refused by policy. Stable across releases so clients can
 * branch on it; the final `data` shape is defined in #14.
 */
export const POLICY_DENIED = -32001

export interface JsonRpcError {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  error: { code: number, message: string, data?: Record<string, unknown> }
}

export function invalidRequest (id: JsonRpcId | null): JsonRpcError {
  return { jsonrpc: '2.0', id, error: { code: INVALID_REQUEST, message: 'Invalid Request' } }
}

export function policyDenied (id: JsonRpcId | null): JsonRpcError {
  // Deliberately minimal: policy IDs and reasons go to the audit log,
  // never to the client (threat model I3).
  return { jsonrpc: '2.0', id, error: { code: POLICY_DENIED, message: 'Denied by policy', data: { outcome: 'deny' } } }
}
