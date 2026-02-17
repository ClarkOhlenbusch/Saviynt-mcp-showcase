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
  const keys = Object.keys(args).sort()
  const keyLabel = keys.length > 0 ? keys.join(',') : 'no-args'

  // Fast shallow hash – avoids full recursive serialization of large payloads
  let hash = 0
  for (const key of keys) {
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) | 0
    }
    const val = args[key]
    if (typeof val === 'string') {
      const sample = val.length <= 64 ? val : val.slice(0, 64)
      for (let i = 0; i < sample.length; i++) {
        hash = (hash * 31 + sample.charCodeAt(i)) | 0
      }
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      hash = (hash * 31 + (Number(val) | 0)) | 0
    }
  }

  return `${keyLabel}#${Math.abs(hash)}`
}

/**
 * Fast byte-size estimator that avoids full JSON.stringify for large objects.
 * Traverses at most ~200 nodes and 3 levels deep before falling back to a
 * multiplier-based estimate. This is intentionally approximate – it is only
 * used for logging and diagnostics, not correctness-critical paths.
 */
export function estimatePayloadBytes(value: unknown): number {
  if (value == null) return 4 // "null"
  if (typeof value === 'string') return value.length
  if (typeof value === 'number' || typeof value === 'boolean') return 8

  // For small payloads the full stringify is fine and accurate
  try {
    const quick = JSON.stringify(value)
    if (quick.length <= 4096) return quick.length
  } catch {
    // Fall through to estimation
  }

  // Walk a bounded portion of the structure
  let bytes = 0
  let visited = 0
  const MAX_VISIT = 200

  function walk(v: unknown, depth: number): void {
    if (visited >= MAX_VISIT || depth > 3) return
    visited++

    if (v == null) { bytes += 4; return }
    if (typeof v === 'string') { bytes += v.length + 2; return }
    if (typeof v === 'number' || typeof v === 'boolean') { bytes += 8; return }

    if (Array.isArray(v)) {
      bytes += 2 // []
      for (let i = 0; i < v.length && visited < MAX_VISIT; i++) {
        walk(v[i], depth + 1)
      }
      // Extrapolate for unvisited items
      if (v.length > 0 && visited >= MAX_VISIT) {
        const sampledItems = Math.min(v.length, visited)
        bytes = Math.ceil(bytes * (v.length / sampledItems))
      }
      return
    }

    if (typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
      bytes += 2 // {}
      for (const [key, nested] of entries) {
        if (visited >= MAX_VISIT) break
        bytes += key.length + 4 // key + quotes + colon + comma
        walk(nested, depth + 1)
      }
      return
    }
  }

  walk(value, 0)
  return bytes
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
