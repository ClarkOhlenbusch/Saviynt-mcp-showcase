import type { Dispatch, SetStateAction } from 'react'
import { MCP_CONFIG_STORAGE_KEY, parseMcpConfig } from '@/components/mcp-config-dialog'
import type { McpPendingRequest } from '@/lib/mcp/types'

const MOCK_FALLBACK_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_MOCK_ACCESS_REVIEWS === 'true'

export type PopulateSnippetOptions = {
  force?: boolean
}

export type PopulateSnippetResult = {
  ok: boolean
  attempted: number
  updated: number
  error?: string
  mode: 'ai' | 'heuristic' | 'cache'
}

const inFlightSnippetRequests = new Map<string, Promise<PopulateSnippetResult>>()

export async function loadPendingRequests(
  saviyntUsername?: string,
  saviyntPassword?: string
): Promise<{
  requests: McpPendingRequest[]
  error: string | null
}> {
  try {
    const savedConfig = localStorage.getItem(MCP_CONFIG_STORAGE_KEY)
    const parsedConfig = savedConfig ? parseMcpConfig(savedConfig) : null

    const res = await fetch('/api/access-reviews/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max: 10,
        serverUrl: parsedConfig?.serverUrl || '',
        authHeader: parsedConfig?.authHeader || '',
        saviyntUsername: saviyntUsername || '',
        saviyntPassword: saviyntPassword || '',
      }),
    })

    if (!res.ok) {
      let errorMessage = `Request lookup failed with status ${res.status}`
      try {
        const errorPayload = await res.json()
        if (isRecord(errorPayload) && typeof errorPayload.error === 'string' && errorPayload.error.trim()) {
          errorMessage = errorPayload.error
        }
        if (
          res.status === 401 &&
          isRecord(errorPayload) &&
          getString(errorPayload.source) === 'auth-required'
        ) {
          const autoLoginConfigured = errorPayload.autoLoginConfigured === true
          const loginAttempted = errorPayload.loginAttempted === true
          if (!autoLoginConfigured) {
            errorMessage = `${errorMessage} Set your Saviynt credentials in Settings for automatic login.`
          } else if (loginAttempted) {
            errorMessage = `${errorMessage} Verify your Saviynt credentials in Settings.`
          }
        }
      } catch {
        // Keep status-based fallback error.
      }
      throw new Error(errorMessage)
    }

    const data = await res.json()
    const endpointItems = Array.isArray(data.items) ? data.items : []
    if (data.success && endpointItems.length > 0) {
      const mappedRequests: McpPendingRequest[] = endpointItems
        .map((rawRequest: unknown) => {
          const req = isRecord(rawRequest) ? rawRequest : {}
          const aiRiskLevelRaw = req.aiRiskLevel

          return {
            requestid: getString(req.requestid) || getString(req.id) || 'N/A',
            requestkey: getString(req.requestkey) || getString(req.key) || '',
            requestedfor: getString(req.requestedfor) || getString(req.firstname) || 'Unknown User',
            requestedby: getString(req.requestedby) || 'System',
            requesttype: getString(req.requesttype) || 'Access Request',
            requestsubmittedon: getString(req.requestsubmittedon),
            duedate: getString(req.duedate),
            requestcomments: getString(req.requestcomments) || 'No comments provided.',
            endpoint: getString(req.endpoint) || getString(req.securitysystem) || '',
            aiRiskAnalysis: getString(req.aiRiskAnalysis) || undefined,
            aiRiskLevel:
              aiRiskLevelRaw === 'high' || aiRiskLevelRaw === 'medium' || aiRiskLevelRaw === 'low'
                ? aiRiskLevelRaw
                : undefined,
            aiInsightSource: getInsightSource(req.aiInsightSource),
          }
        })
        .filter((item: McpPendingRequest) => Boolean(item.requestid || item.requestkey))

      return { requests: mappedRequests, error: null }
    }

    if (MOCK_FALLBACK_ENABLED) {
      return { requests: buildMockRequests(false), error: null }
    }

    return { requests: [], error: null }
  } catch (err) {
    console.error('Error fetching real requests:', err)
    if (MOCK_FALLBACK_ENABLED) {
      return { requests: buildMockRequests(true), error: null }
    }
    return {
      requests: [],
      error: err instanceof Error ? err.message : 'Failed to fetch pending requests',
    }
  }
}

export async function populateAgentSnippets(
  currentRequests: McpPendingRequest[],
  apiKey: string,
  setRequests: Dispatch<SetStateAction<McpPendingRequest[]>>,
  options: PopulateSnippetOptions = {}
): Promise<PopulateSnippetResult> {
  const targets = options.force
    ? currentRequests.slice(0, 12)
    : currentRequests
      .filter((item) => !item.aiRiskAnalysis || !item.aiRiskAnalysis.trim())
      .slice(0, 12)

  if (targets.length === 0) {
    return { ok: true, attempted: 0, updated: 0, mode: 'cache' }
  }

  const dedupeKey = buildSnippetRequestKey(targets, options.force === true, apiKey.trim())
  const inFlight = inFlightSnippetRequests.get(dedupeKey)
  if (inFlight) return inFlight

  const promise = (async (): Promise<PopulateSnippetResult> => {
    try {
      const res = await fetch('/api/access-reviews/snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          force: options.force === true,
          allowHeuristicOnError: false,
          requests: targets.map((item) => ({
            requestid: item.requestid,
            requestkey: item.requestkey,
            requestedfor: item.requestedfor,
            requesttype: item.requesttype,
            endpoint: item.endpoint || item.securitysystem || '',
            duedate: item.duedate,
            requestcomments: item.requestcomments,
          })),
        }),
      })

      if (!res.ok) {
        let message = `Snippet request failed with status ${res.status}`
        try {
          const payload = await res.json()
          if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()) {
            message = payload.error
          }
        } catch {
          // Keep status-based fallback message.
        }

        return {
          ok: false,
          attempted: targets.length,
          updated: 0,
          error: message,
          mode: 'ai',
        }
      }

      const data = await res.json()
      if (!isRecord(data) || !Array.isArray(data.snippets)) {
        return {
          ok: false,
          attempted: targets.length,
          updated: 0,
          error: 'Snippet response was not in the expected format.',
          mode: 'ai',
        }
      }

      const source = getString(data.source).toLowerCase()
      const mode: 'ai' | 'heuristic' | 'cache' =
        source.includes('heuristic')
          ? 'heuristic'
          : source.includes('cache')
            ? 'cache'
            : 'ai'

      const snippetMap = new Map<string, {
        snippet: string
        riskLevel?: McpPendingRequest['aiRiskLevel']
        source?: McpPendingRequest['aiInsightSource']
      }>()

      for (const rawSnippet of data.snippets) {
        if (!isRecord(rawSnippet)) continue
        const requestid = getString(rawSnippet.requestid)
        const snippet = getString(rawSnippet.snippet)
        const riskLevelRaw = rawSnippet.riskLevel
        const snippetSourceRaw = getString(rawSnippet.source).toLowerCase()
        const snippetSource =
          snippetSourceRaw === 'ai' || snippetSourceRaw === 'heuristic' || snippetSourceRaw === 'cache'
            ? snippetSourceRaw
            : mode === 'heuristic'
              ? 'heuristic'
              : mode === 'cache'
                ? 'cache'
                : 'ai'

        if (!requestid || !snippet) continue

        snippetMap.set(requestid, {
          snippet,
          riskLevel:
            riskLevelRaw === 'high' || riskLevelRaw === 'medium' || riskLevelRaw === 'low'
              ? riskLevelRaw
              : undefined,
          source: snippetSource,
        })
      }

      if (snippetMap.size === 0) {
        return { ok: true, attempted: targets.length, updated: 0, mode }
      }

      let updatedCount = 0

      setRequests((prev) => prev.map((request) => {
        const match =
          snippetMap.get(request.requestid) ||
          (request.requestkey ? snippetMap.get(request.requestkey) : undefined)
        if (!match) return request

        const nextRiskAnalysis = options.force
          ? match.snippet
          : request.aiRiskAnalysis || match.snippet
        const nextRiskLevel = options.force
          ? match.riskLevel || request.aiRiskLevel
          : request.aiRiskLevel || match.riskLevel
        const nextInsightSource = options.force
          ? match.source || request.aiInsightSource
          : request.aiInsightSource || match.source

        const changed =
          nextRiskAnalysis !== request.aiRiskAnalysis ||
          nextRiskLevel !== request.aiRiskLevel ||
          nextInsightSource !== request.aiInsightSource

        if (!changed) return request

        updatedCount += 1
        return {
          ...request,
          aiRiskAnalysis: nextRiskAnalysis,
          aiRiskLevel: nextRiskLevel,
          aiInsightSource: nextInsightSource,
        }
      }))

      return { ok: true, attempted: targets.length, updated: updatedCount, mode }
    } catch (err) {
      return {
        ok: false,
        attempted: targets.length,
        updated: 0,
        error: err instanceof Error ? err.message : 'Unknown snippet refresh error.',
        mode: 'ai',
      }
    } finally {
      inFlightSnippetRequests.delete(dedupeKey)
    }
  })()

  inFlightSnippetRequests.set(dedupeKey, promise)
  return promise
}

function buildSnippetRequestKey(
  targets: McpPendingRequest[],
  force: boolean,
  apiKey: string
): string {
  const keyMode = apiKey ? 'with-key' : 'no-key'
  const ids = targets.map((item) => `${item.requestid}:${item.requestkey}`).join('|')
  const freshness = targets.map((item) => (item.aiRiskAnalysis ? '1' : '0')).join('')
  return `${force ? 'force' : 'auto'}:${keyMode}:${ids}:${freshness}`
}

function buildMockRequests(requestFailed: boolean): McpPendingRequest[] {
  return [
    {
      requestid: 'DEMO-001',
      requestkey: 'mock-1',
      requestedfor: 'John Doe',
      requestedby: 'Jane Smith',
      requesttype: 'New Account',
      requestsubmittedon: '2026-02-10',
      duedate: '2026-02-15',
      requestcomments: 'Needs access to AWS Production for the new billing project.',
      endpoint: 'AWS-Production',
      aiRiskAnalysis: requestFailed
        ? 'This is demo data shown because pending request retrieval failed in non-production mode.'
        : 'This is demo data. In production mode, pending requests come directly from Saviynt.',
      aiRiskLevel: 'medium',
      aiInsightSource: 'heuristic',
    },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function getInsightSource(value: unknown): McpPendingRequest['aiInsightSource'] {
  const normalized = getString(value).toLowerCase()
  if (normalized === 'ai' || normalized === 'heuristic' || normalized === 'cache') {
    return normalized
  }
  return undefined
}
