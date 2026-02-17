import type { McpServerConfig, McpToolSchema } from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getRpcId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export function getRpcErrorMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (!isRecord(value)) return null

  const message = value.message
  return typeof message === 'string' && message.trim() ? message : null
}

function toMcpToolSchema(value: unknown): McpToolSchema | null {
  if (!isRecord(value)) return null
  if (typeof value.name !== 'string' || !value.name) return null

  return {
    name: value.name,
    description: typeof value.description === 'string' ? value.description : undefined,
    inputSchema: isRecord(value.inputSchema) ? value.inputSchema : undefined,
  }
}

export function extractTools(rpcResponse: Record<string, unknown>): McpToolSchema[] {
  const result = isRecord(rpcResponse.result) ? rpcResponse.result : null
  const tools = Array.isArray(result?.tools) ? result.tools : []
  return tools
    .map((tool) => toMcpToolSchema(tool))
    .filter((tool): tool is McpToolSchema => tool !== null)
}

export function extractToolCallResult(rpcResponse: Record<string, unknown>): unknown {
  const result = rpcResponse.result
  if (isRecord(result) && 'content' in result) {
    return result.content ?? result
  }
  return result ?? rpcResponse
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`)

  return `{${entries.join(',')}}`
}

export function argsFingerprint(args: Record<string, unknown>): string {
  const serialized = stableSerialize(args)
  let hash = 0
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash * 31 + serialized.charCodeAt(i)) | 0
  }

  const keys = Object.keys(args).sort()
  const keyLabel = keys.length > 0 ? keys.join(',') : 'no-args'
  return `${keyLabel}#${Math.abs(hash)}`
}

export function estimatePayloadBytes(value: unknown): number {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    return new TextEncoder().encode(serialized).length
  } catch {
    return 0
  }
}

export function getHeaders(config: McpServerConfig): Record<string, string> {
  let auth = config.authHeader
  if (auth && !auth.includes(' ')) {
    if (!auth.startsWith('Bearer')) {
      auth = `Bearer ${auth}`
    } else {
      auth = auth.replace('Bearer', 'Bearer ')
    }
  }
  return {
    'Content-Type': 'application/json',
    ...(auth ? { Authorization: auth } : {}),
  }
}

function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

function normalizeAuthHeader(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const bearerMatch = trimmed.match(/^bearer\s+(.+)$/i)
  if (bearerMatch) {
    return `Bearer ${bearerMatch[1].trim()}`
  }

  if (/^bearer$/i.test(trimmed)) {
    return 'Bearer'
  }

  return trimmed
}

export function isSameConfig(a: McpServerConfig | null, b: McpServerConfig): boolean {
  if (!a) return false
  return (
    normalizeServerUrl(a.serverUrl) === normalizeServerUrl(b.serverUrl) &&
    normalizeAuthHeader(a.authHeader) === normalizeAuthHeader(b.authHeader)
  )
}
