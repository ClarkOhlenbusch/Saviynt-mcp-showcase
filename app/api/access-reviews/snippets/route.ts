import {
  buildFallbackSnippets,
  isRecord,
  normalizeAiSnippetText,
  normalizeRequests,
  type SnippetProvider,
  type SnippetResponseItem,
} from './snippets-heuristics'
import {
  RATE_LIMIT_COOLDOWN_MS,
  cacheSnippet,
  extractRetryAfterMs,
  generateAiSnippets,
  getAvailableProviderCandidates,
  getMinimumProviderRetryMs,
  isInvalidApiKeyError,
  isRateLimitError,
  markProviderRateLimited,
  mergeSnippetsInRequestOrder,
  pruneCaches,
  resolveCachedSnippets,
  resolveProviderCandidates,
} from './snippets-service'

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null)
  const payload = isRecord(body) ? body : {}
  const clientGeminiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : ''
  const force = payload.force === true
  const allowHeuristicOnError = payload.allowHeuristicOnError === true
  const requests = normalizeRequests(payload.requests)

  if (requests.length === 0) {
    return Response.json({ success: true, source: 'cache', snippets: [] })
  }

  const now = Date.now()
  pruneCaches(now)

  const { cachedSnippets, missingRequests } = resolveCachedSnippets(requests, now, force)
  const providerCandidates = resolveProviderCandidates(clientGeminiKey)

  if (providerCandidates.length === 0) {
    const heuristicSnippets = buildFallbackSnippets(missingRequests)
    const merged = mergeSnippetsInRequestOrder(requests, cachedSnippets, heuristicSnippets)

    return Response.json({
      success: true,
      source: merged.some((item) => item.source === 'heuristic') ? 'heuristic' : 'cache',
      snippets: merged,
    })
  }

  if (missingRequests.length === 0) {
    return Response.json({ success: true, source: 'cache', snippets: cachedSnippets })
  }

  const availableCandidates = getAvailableProviderCandidates(providerCandidates, now)

  if (availableCandidates.length === 0) {
    const retryAfterMs = getMinimumProviderRetryMs(providerCandidates, now) ?? RATE_LIMIT_COOLDOWN_MS
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
    if (allowHeuristicOnError) {
      const heuristicSnippets = buildFallbackSnippets(missingRequests)
      const merged = mergeSnippetsInRequestOrder(requests, cachedSnippets, heuristicSnippets)
      return Response.json({
        success: true,
        source: 'heuristic',
        snippets: merged,
        warning: `All configured AI providers are rate-limited; returned heuristic insights. Retry in ~${retryAfterSeconds}s.`,
      })
    }

    return Response.json(
      {
        success: false,
        code: 'rate_limited',
        error: `All configured AI providers are rate-limited. Retry in about ${retryAfterSeconds}s.`,
        snippets: cachedSnippets,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
        },
      }
    )
  }

  let usedProvider: SnippetProvider | null = null
  let aiSnippets: SnippetResponseItem[] = []
  let sawRateLimit = false
  let sawInvalidApiKey = false
  let sawTimeout = false
  const providerFailures: string[] = []

  for (const candidate of availableCandidates) {
    try {
      aiSnippets = await generateAiSnippets(candidate, missingRequests)
      usedProvider = candidate.provider
      break
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to generate snippets using ${candidate.provider}`
      const normalized = message.toLowerCase()
      providerFailures.push(`${candidate.provider}: ${message}`)

      if (isRateLimitError(normalized)) {
        sawRateLimit = true
        const retryAfterMs = extractRetryAfterMs(normalized) ?? RATE_LIMIT_COOLDOWN_MS
        markProviderRateLimited(candidate, retryAfterMs)
        continue
      }

      if (isInvalidApiKeyError(normalized)) {
        sawInvalidApiKey = true
        continue
      }

      if (normalized.includes('timed out') || normalized.includes('timeout')) {
        sawTimeout = true
      }
    }
  }

  if (!usedProvider) {
    const failureDetail = providerFailures[providerFailures.length - 1] || 'Failed to generate snippets'

    if (allowHeuristicOnError) {
      const heuristicSnippets = buildFallbackSnippets(missingRequests)
      const merged = mergeSnippetsInRequestOrder(requests, cachedSnippets, heuristicSnippets)
      return Response.json({
        success: true,
        source: 'heuristic',
        snippets: merged,
        warning: failureDetail,
      })
    }

    if (sawRateLimit) {
      const retryAfterMs = getMinimumProviderRetryMs(providerCandidates, Date.now()) ?? RATE_LIMIT_COOLDOWN_MS
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
      return Response.json(
        {
          success: false,
          code: 'rate_limited',
          error: `AI provider rate limit reached. Retry in about ${retryAfterSeconds}s.`,
          snippets: cachedSnippets,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSeconds),
          },
        }
      )
    }

    if (sawInvalidApiKey) {
      return Response.json(
        {
          success: false,
          code: 'invalid_api_key',
          error: 'Configured AI provider API key is invalid or missing required permissions.',
          snippets: cachedSnippets,
        },
        { status: 401 }
      )
    }

    if (sawTimeout) {
      return Response.json(
        {
          success: false,
          code: 'upstream_timeout',
          error: 'Insight generation timed out across all configured providers.',
          snippets: cachedSnippets,
        },
        { status: 504 }
      )
    }

    return Response.json(
      {
        success: false,
        code: 'snippet_generation_failed',
        error: failureDetail,
        snippets: cachedSnippets,
      },
      { status: 502 }
    )
  }

  if (aiSnippets.length === 0) {
    return Response.json(
      {
        success: false,
        code: 'empty_ai_response',
        error: 'Insight model returned no usable snippets.',
        snippets: cachedSnippets,
      },
      { status: 502 }
    )
  }

  const aiByRequestId = new Map<string, SnippetResponseItem>()
  for (const item of aiSnippets) {
    aiByRequestId.set(item.requestid, item)
  }

  const mergedAiSnippets: SnippetResponseItem[] = []
  const matchedRequestIds = new Set<string>()
  for (const request of missingRequests) {
    const matched = aiByRequestId.get(request.requestid) || aiByRequestId.get(request.requestkey)
    if (!matched) continue

    const normalizedItem: SnippetResponseItem = {
      requestid: request.requestid,
      snippet: normalizeAiSnippetText(matched.snippet, request, matched.riskLevel),
      riskLevel: matched.riskLevel,
      source: 'ai',
    }

    mergedAiSnippets.push(normalizedItem)
    matchedRequestIds.add(request.requestid)
    cacheSnippet(request, normalizedItem, now)
  }

  const unmatchedRequests = missingRequests.filter((request) => !matchedRequestIds.has(request.requestid))
  const fallbackForUnmatched = buildFallbackSnippets(unmatchedRequests)
  for (const request of unmatchedRequests) {
    const fallback = fallbackForUnmatched.find((item) => item.requestid === request.requestid)
    if (!fallback) continue
    cacheSnippet(request, fallback, now)
  }

  const generated = [...mergedAiSnippets, ...fallbackForUnmatched]
  if (generated.length === 0) {
    return Response.json(
      {
        success: false,
        code: 'ai_mapping_failed',
        error: 'Insight model output could not be matched to pending request IDs.',
        snippets: cachedSnippets,
      },
      { status: 502 }
    )
  }

  const merged = mergeSnippetsInRequestOrder(requests, cachedSnippets, generated)
  return Response.json({
    success: true,
    source: fallbackForUnmatched.length > 0 ? 'mixed' : 'ai',
    provider: usedProvider,
    fallbackCount: fallbackForUnmatched.length,
    snippets: merged,
  })
}
