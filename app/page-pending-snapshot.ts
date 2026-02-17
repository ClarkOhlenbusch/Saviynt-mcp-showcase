import { MCP_CONFIG_STORAGE_KEY, parseMcpConfig } from '@/components/mcp-config-dialog'
import type { McpPendingRequestSummary } from '@/lib/mcp/types'

export const PENDING_REQUEST_REFRESH_MS = 120_000
const MAX_PENDING_SNAPSHOT_ITEMS = 10

function normalizePendingRequestSummary(value: unknown): McpPendingRequestSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>

  const requestid = typeof item.requestid === 'string' ? item.requestid : ''
  const requestkey = typeof item.requestkey === 'string' ? item.requestkey : ''

  if (!requestid && !requestkey) return null

  return {
    requestid: requestid || requestkey || 'N/A',
    requestkey: requestkey || requestid || '',
    requestedfor: typeof item.requestedfor === 'string' ? item.requestedfor : 'Unknown User',
    requesttype: typeof item.requesttype === 'string' ? item.requesttype : 'Access Request',
    duedate: typeof item.duedate === 'string' ? item.duedate : '',
    endpoint: typeof item.endpoint === 'string'
      ? item.endpoint
      : typeof item.securitysystem === 'string'
        ? item.securitysystem
        : '',
  }
}

export async function fetchPendingRequestSnapshot(forceRefresh = false): Promise<{
  items: McpPendingRequestSummary[]
  fetchedAt: number
}> {
  const savedConfig = localStorage.getItem(MCP_CONFIG_STORAGE_KEY)
  const parsedConfig = savedConfig ? parseMcpConfig(savedConfig) : null

  const res = await fetch('/api/access-reviews/pending', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      max: MAX_PENDING_SNAPSHOT_ITEMS,
      refresh: forceRefresh,
      serverUrl: parsedConfig?.serverUrl || '',
      authHeader: parsedConfig?.authHeader || '',
    }),
  })

  if (!res.ok) {
    throw new Error(`Pending request snapshot failed with status ${res.status}`)
  }

  const data = await res.json()
  const rawItems = Array.isArray(data.items) ? data.items : []
  const items = rawItems
    .map((item: unknown) => normalizePendingRequestSummary(item))
    .filter((item: McpPendingRequestSummary | null): item is McpPendingRequestSummary => item !== null)
    .slice(0, MAX_PENDING_SNAPSHOT_ITEMS)

  return {
    items,
    fetchedAt: typeof data.fetchedAt === 'number' ? data.fetchedAt : Date.now(),
  }
}
