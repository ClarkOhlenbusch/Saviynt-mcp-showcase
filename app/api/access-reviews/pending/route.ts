import { callTool, checkAndAutoConnect, connectToMcp } from '@/lib/mcp/client'
import type { McpPendingRequest } from '@/lib/mcp/types'

const DEFAULT_MAX_REQUESTS = 10
const MAX_REQUESTS_LIMIT = 50
const DEFAULT_PASSES = 1
const MAX_PASSES = 5
const PER_CALL_MAX = 10
const CACHE_TTL_MS = parsePositiveInt(process.env.PENDING_REQUEST_CACHE_TTL_MS, 60_000)
const SAVIYNT_USERNAME_ENV_KEYS = ['SAVIYNT_USERNAME', 'SAVIYNT_LOGIN_USERNAME'] as const
const SAVIYNT_PASSWORD_ENV_KEYS = ['SAVIYNT_PASSWORD', 'SAVIYNT_LOGIN_PASSWORD'] as const

type PendingRequestCache = {
  items: McpPendingRequest[]
  fetchedAt: number
}

let cache: PendingRequestCache | null = null

export async function GET(req: Request) {
  return handlePendingRequest(req, null, {})
}

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null)
  const payload = isRecord(body) ? body : {}
  const mcpConfig = extractMcpConfig(payload)
  return handlePendingRequest(req, mcpConfig, payload)
}

async function handlePendingRequest(
  req: Request,
  mcpConfig: { serverUrl: string; authHeader: string } | null,
  payload: Record<string, unknown>
) {
  const url = new URL(req.url)
  const refresh = url.searchParams.get('refresh') === 'true' || payload.refresh === true
  const maxFromBody = typeof payload.max === 'number' ? String(payload.max) : null
  const max = clampPositiveInt(maxFromBody ?? url.searchParams.get('max'), DEFAULT_MAX_REQUESTS, MAX_REQUESTS_LIMIT)
  const passesFromBody = typeof payload.passes === 'number' ? String(payload.passes) : null
  const passes = clampPositiveInt(passesFromBody ?? url.searchParams.get('passes'), DEFAULT_PASSES, MAX_PASSES)

  const now = Date.now()
  const cacheFresh = cache && now - cache.fetchedAt <= CACHE_TTL_MS

  if (!refresh && cacheFresh) {
    return Response.json({
      success: true,
      source: 'cache',
      fetchedAt: cache!.fetchedAt,
      items: cache!.items.slice(0, max),
    })
  }

  try {
    if (mcpConfig) {
      const status = await connectToMcp(mcpConfig)
      if (!status.connected) {
        throw new Error(status.error || 'Failed to connect MCP with provided config')
      }
    } else {
      await checkAndAutoConnect()
    }

    const toolResult = await callPendingRequestTool(max, mcpConfig, passes)

    if (!toolResult.success) {
      throw new Error(toolResult.error || 'Pending request tool call failed')
    }

    let effectiveToolResult = toolResult
    let authRequired = extractAuthRequired(effectiveToolResult.result)
    const loginCredentials = resolveSaviyntCredentials(payload)
    const autoLoginConfigured = hasSaviyntCredentialsConfigured()
    let loginAttempted = false
    let loginError: string | null = null

    if (authRequired && loginCredentials) {
      loginAttempted = true
      const loginResult = await attemptSaviyntLogin(loginCredentials.username, loginCredentials.password)
      if (loginResult.success) {
        const retried = await callPendingRequestTool(max, mcpConfig, passes)
        if (retried.success) {
          effectiveToolResult = retried
          authRequired = extractAuthRequired(effectiveToolResult.result)
        } else {
          loginError = retried.error || 'Failed to retrieve pending requests after login.'
        }
      } else {
        loginError = loginResult.error || 'Login failed.'
      }
    }

    if (authRequired) {
      const message = loginError
        ? `${authRequired.message} Automatic login failed: ${loginError}`
        : authRequired.message
      return Response.json(
        {
          success: false,
          source: 'auth-required',
          error: message,
          action: authRequired.action,
          form: authRequired.form,
          loginAttempted,
          autoLoginConfigured,
          items: [],
        },
        { status: 401 }
      )
    }

    const rawRequests = extractRawRequestList(effectiveToolResult.result)

    const mapped = rawRequests
      .map((item) => toPendingRequest(item))
      .filter((item): item is McpPendingRequest => item !== null)
      .slice(0, max)

    cache = {
      items: mapped,
      fetchedAt: now,
    }

    return Response.json({
      success: true,
      source: 'live',
      fetchedAt: now,
      items: mapped,
    })
  } catch (err) {
    if (cache) {
      return Response.json({
        success: true,
        source: 'stale-cache',
        fetchedAt: cache.fetchedAt,
        stale: true,
        error: err instanceof Error ? err.message : 'Failed to refresh pending requests',
        items: cache.items.slice(0, max),
      })
    }

    const message = err instanceof Error ? err.message : 'Failed to fetch pending requests'
    const normalizedMessage = message.toLowerCase()
    const status =
      normalizedMessage.includes('no mcp config available') || isRetryablePendingError(message)
        ? 503
        : 500
    return Response.json(
      {
        success: false,
        source: 'error',
        error: message,
        items: [],
      },
      { status }
    )
  }
}

async function callPendingRequestTool(
  max: number,
  mcpConfig: { serverUrl: string; authHeader: string } | null,
  passes: number = 1
) {
  const first = await callTool('get_list_of_pending_requests_for_approver', { max: PER_CALL_MAX })
  if (!first.success) {
    if (!isRetryablePendingError(first.error)) {
      return first
    }

    if (mcpConfig) {
      const status = await connectToMcp(mcpConfig)
      if (!status.connected) return first
    } else {
      await checkAndAutoConnect()
    }

    const retry = await callTool('get_list_of_pending_requests_for_approver', { max: PER_CALL_MAX })
    if (!retry.success) {
      if (!retry.error && first.error) {
        return { ...retry, error: first.error }
      }
      return retry
    }

    // Single-pass: return the retry result directly
    if (passes <= 1) return retry

    // Multi-pass: use retry as the seed and continue below
    return await multiPassFetch(retry, max, mcpConfig, passes - 1)
  }

  if (passes <= 1) return first

  return await multiPassFetch(first, max, mcpConfig, passes - 1)
}

/**
 * Makes additional MCP calls to accumulate more unique pending requests.
 * Deduplicates by requestkey/requestid across all passes.
 */
async function multiPassFetch(
  seedResult: { success: boolean; result?: unknown; error?: string },
  max: number,
  mcpConfig: { serverUrl: string; authHeader: string } | null,
  remainingPasses: number
) {
  // Build a deduplication set from the seed results
  const seedList = extractRawRequestList(seedResult.result)
  const seen = new Set<string>()
  const allItems: unknown[] = []

  for (const item of seedList) {
    const key = dedupeKey(item)
    if (key && !seen.has(key)) {
      seen.add(key)
      allItems.push(item)
    }
  }

  let currentOffset = seedList.length

  for (let i = 0; i < remainingPasses && allItems.length < max; i++) {
    try {
      const next = await callTool('get_list_of_pending_requests_for_approver', {
        max: PER_CALL_MAX,
        offset: currentOffset,
      })
      if (!next.success) {
        // On connection error, try to reconnect once and retry this pass
        if (isRetryablePendingError(next.error)) {
          if (mcpConfig) {
            const status = await connectToMcp(mcpConfig)
            if (!status.connected) continue
          } else {
            await checkAndAutoConnect()
          }
          const retried = await callTool('get_list_of_pending_requests_for_approver', {
            max: PER_CALL_MAX,
            offset: currentOffset,
          })
          if (!retried.success) continue
          const retriedItems = extractRawRequestList(retried.result)
          for (const item of retriedItems) {
            const key = dedupeKey(item)
            if (key && !seen.has(key)) {
              seen.add(key)
              allItems.push(item)
            }
          }
          currentOffset += PER_CALL_MAX
        }
        continue
      }

      const nextItems = extractRawRequestList(next.result)

      // If the MCP returned zero items, we've exhausted all pages
      if (nextItems.length === 0) break

      let newCount = 0
      for (const item of nextItems) {
        const key = dedupeKey(item)
        if (key && !seen.has(key)) {
          seen.add(key)
          allItems.push(item)
          newCount++
        }
      }

      currentOffset += PER_CALL_MAX

      // If a pass returned zero new unique items, further passes are unlikely to help
      if (newCount === 0) break
    } catch {
      // Swallow errors on additional passes; we already have seed data
      continue
    }
  }

  // Return a synthetic result containing all accumulated items
  return {
    success: true,
    result: { requests: allItems },
    error: undefined,
  }
}

/** Build a stable deduplication key from a raw pending request object. */
function dedupeKey(item: unknown): string | null {
  if (!isRecord(item)) return null
  const key = firstNonEmptyString(item.requestkey, item.request_key, item.key)
  const id = firstNonEmptyString(item.requestid, item.request_id, item.id) ||
    firstFiniteNumberAsString(item.request_key, item.requestkey, item.id)
  return key || id || null
}

function isRetryablePendingError(error: string | undefined): boolean {
  const message = (error || '').toLowerCase()
  if (!message) return false

  return (
    message.includes('sse connection lost') ||
    message.includes('not connected') ||
    message.includes('reconnecting to mcp server') ||
    message.includes('failed to establish sse connection') ||
    message.includes('sse stream ended')
  )
}

function extractMcpConfig(value: Record<string, unknown>): { serverUrl: string; authHeader: string } | null {
  const serverUrl = getString(value.serverUrl)
  const authHeader = getString(value.authHeader)
  if (!serverUrl || !authHeader) return null
  return { serverUrl, authHeader }
}

function extractRawRequestList(result: unknown): unknown[] {
  const extracted = extractRawRequestListRecursive(result, 0)
  return Array.isArray(extracted) ? extracted : []
}

function extractAuthRequired(result: unknown): {
  message: string
  action?: string
  form?: unknown
} | null {
  const source = normalizeAuthSource(result)
  if (!source) return null

  const error = getString(source.error).toLowerCase()
  const message = getString(source.message)
  const action = getString(source.action)
  const form = source.form

  const isLoginRequired =
    error.includes('login required') ||
    message.toLowerCase().includes('login required') ||
    action === 'render_login_form'

  if (!isLoginRequired) return null

  return {
    message: message || 'Login required before pending approvals can be retrieved.',
    action: action || undefined,
    form: form ?? undefined,
  }
}

function normalizeAuthSource(result: unknown): Record<string, unknown> | null {
  if (isRecord(result) && isRecord(result.structuredContent)) {
    return result.structuredContent
  }

  if (isRecord(result)) {
    return result
  }

  if (Array.isArray(result)) {
    return parseFirstJsonObjectFromContent(result)
  }

  return null
}

function extractRawRequestListRecursive(result: unknown, depth: number): unknown[] {
  if (depth > 3) return []

  if (Array.isArray(result)) {
    const parsedFromMcpContent = parseMcpContentArray(result)
    if (parsedFromMcpContent.length > 0) return parsedFromMcpContent
    return result
  }

  if (!isRecord(result)) return []

  if (Array.isArray(result.requests)) return result.requests
  if (Array.isArray(result.data)) return result.data
  if (Array.isArray(result.items)) return result.items
  if (Array.isArray(result.pendingRequests)) return result.pendingRequests
  if (Array.isArray(result.pending_requests)) return result.pending_requests

  if (isRecord(result.structuredContent)) {
    const nestedStructured = extractRawRequestListRecursive(result.structuredContent, depth + 1)
    if (nestedStructured.length > 0) return nestedStructured
  }

  if (Array.isArray(result.content)) {
    const parsedFromContent = parseMcpContentArray(result.content)
    if (parsedFromContent.length > 0) return parsedFromContent
  }

  if (isRecord(result.result)) {
    const nested = extractRawRequestListRecursive(result.result, depth + 1)
    if (nested.length > 0) return nested
  }

  return []
}

function parseMcpContentArray(content: unknown[]): unknown[] {
  for (const item of content) {
    if (!isRecord(item)) continue

    const text = getString(item.text)
    if (!text) continue

    const parsed = parseJson(text)
    if (!parsed) continue

    const nested = extractRawRequestListRecursive(parsed, 0)
    if (nested.length > 0) return nested
  }

  return []
}

function parseFirstJsonObjectFromContent(content: unknown[]): Record<string, unknown> | null {
  for (const item of content) {
    if (!isRecord(item)) continue

    const text = getString(item.text)
    if (!text) continue

    const parsed = parseJson(text)
    if (isRecord(parsed)) return parsed
  }

  return null
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function attemptSaviyntLogin(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  const loginResult = await callTool('login', { username, password })
  if (!loginResult.success) {
    return {
      success: false,
      error: loginResult.error || 'Login tool call failed.',
    }
  }

  const loginError = extractLoginError(loginResult.result)
  if (loginError) {
    return {
      success: false,
      error: loginError,
    }
  }

  return { success: true }
}

function extractLoginError(result: unknown): string | null {
  const payload = normalizeAuthSource(result)
  if (!payload) return null

  const success = payload.success
  if (success === true) return null

  const error = getString(payload.error)
  if (error) return error

  const message = getString(payload.message)
  if (message && !message.toLowerCase().includes('success')) return message

  return success === false ? 'Login failed.' : null
}

function resolveSaviyntCredentials(payload: Record<string, unknown>): { username: string; password: string } | null {
  const username =
    firstNonEmptyString(payload.saviyntUsername, payload.username) ||
    readFirstEnvValue(SAVIYNT_USERNAME_ENV_KEYS)
  const password =
    firstNonEmptyString(payload.saviyntPassword, payload.password) ||
    readFirstEnvValue(SAVIYNT_PASSWORD_ENV_KEYS)

  if (!username || !password) return null
  return { username, password }
}

function hasSaviyntCredentialsConfigured(): boolean {
  return Boolean(readFirstEnvValue(SAVIYNT_USERNAME_ENV_KEYS) && readFirstEnvValue(SAVIYNT_PASSWORD_ENV_KEYS))
}

function readFirstEnvValue(keys: readonly string[]): string {
  for (const key of keys) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function toPendingRequest(value: unknown): McpPendingRequest | null {
  if (!isRecord(value)) return null

  const requestkey =
    firstNonEmptyString(value.requestkey, value.request_key, value.key) ||
    firstFiniteNumberAsString(value.request_key, value.requestkey, value.id)
  const requestid =
    firstNonEmptyString(value.requestid, value.request_id, value.id, value.requestkey, value.request_key) ||
    firstFiniteNumberAsString(value.requestid, value.request_id, value.id, value.request_key)

  if (!requestid && !requestkey) return null

  const aiRiskLevel = value.aiRiskLevel
  const aiInsightSourceRaw = getString(value.aiInsightSource).toLowerCase()

  return {
    requestid: requestid || requestkey || 'N/A',
    requestkey: requestkey || requestid || '',
    requestedfor: firstNonEmptyString(value.requestedfor, value.firstname, value.requestee) || 'Unknown User',
    requestedby: firstNonEmptyString(value.requestedby, value.requestor) || 'System',
    requesttype: firstNonEmptyString(value.requesttype, value.request_type) || 'Access Request',
    requestsubmittedon: firstNonEmptyString(value.requestsubmittedon, value.request_date),
    duedate: firstNonEmptyString(value.duedate, value.due_date),
    requestcomments: firstNonEmptyString(value.requestcomments, value.comments, value.activity_name) || 'No comments provided.',
    endpoint: firstNonEmptyString(value.endpoint, value.securitysystem, value.endpoints) || '',
    securitysystem: firstNonEmptyString(value.securitysystem, value.endpoints) || '',
    aiRiskAnalysis: getString(value.aiRiskAnalysis) || undefined,
    aiRiskLevel: aiRiskLevel === 'low' || aiRiskLevel === 'medium' || aiRiskLevel === 'high'
      ? aiRiskLevel
      : getString(value.sod).toLowerCase() === 'true'
        ? 'high'
        : undefined,
    aiInsightSource:
      aiInsightSourceRaw === 'ai' || aiInsightSourceRaw === 'heuristic' || aiInsightSourceRaw === 'cache'
        ? aiInsightSourceRaw
        : undefined,
  }
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function firstFiniteNumberAsString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function clampPositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}
