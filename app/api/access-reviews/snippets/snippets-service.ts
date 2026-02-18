import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import { GEMINI_SNIPPETS_MODEL } from '@/lib/gemini-usage'
import {
  buildPrompt,
  buildSnippetCacheKey,
  dedupeAndOrderSnippets,
  firstNonEmptyString,
  inferRiskLevel,
  isRecord,
  normalizeAiSnippetText,
  normalizeRiskLevel,
  truncate,
  type PendingSnippetRequest,
  type SnippetProvider,
  type SnippetResponseItem,
} from './snippets-heuristics'

const MAX_OUTPUT_TOKENS = 900
const SNIPPET_CACHE_TTL_MS = parsePositiveInt(process.env.ACCESS_REVIEW_SNIPPET_CACHE_TTL_MS, 15 * 60_000)
export const RATE_LIMIT_COOLDOWN_MS = parsePositiveInt(process.env.ACCESS_REVIEW_SNIPPET_RATE_LIMIT_COOLDOWN_MS, 60_000)
const AI_TIMEOUT_MS = parsePositiveInt(process.env.ACCESS_REVIEW_SNIPPET_TIMEOUT_MS, 30_000)
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_INSIGHTS_MODEL = (process.env.ACCESS_REVIEW_GROQ_MODEL || 'allam-2-7b').trim()

const SnippetSchema = z.object({
  snippets: z.array(z.object({
    requestid: z.string(),
    snippet: z.string(),
    riskLevel: z.enum(['low', 'medium', 'high']),
  })),
})

type CachedSnippet = {
  snippet: string
  riskLevel: SnippetResponseItem['riskLevel']
  expiresAt: number
}

export type ProviderCandidate = {
  provider: SnippetProvider
  key: string
  rateLimitKey: string
}

const snippetCache = new Map<string, CachedSnippet>()
const rateLimitUntilByProvider = new Map<string, number>()

export function resolveCachedSnippets(
  requests: PendingSnippetRequest[],
  now: number,
  force: boolean
): { cachedSnippets: SnippetResponseItem[]; missingRequests: PendingSnippetRequest[] } {
  const cachedSnippets: SnippetResponseItem[] = []
  const missingRequests: PendingSnippetRequest[] = []

  for (const request of requests) {
    if (force) {
      missingRequests.push(request)
      continue
    }

    const cacheKey = buildSnippetCacheKey(request)
    const cached = snippetCache.get(cacheKey)
    if (!cached || cached.expiresAt <= now) {
      missingRequests.push(request)
      continue
    }

    cachedSnippets.push({
      requestid: request.requestid,
      snippet: cached.snippet,
      riskLevel: cached.riskLevel,
      source: 'cache',
    })
  }

  return { cachedSnippets, missingRequests }
}

export function cacheSnippet(request: PendingSnippetRequest, item: SnippetResponseItem, now: number) {
  snippetCache.set(buildSnippetCacheKey(request), {
    snippet: item.snippet,
    riskLevel: item.riskLevel,
    expiresAt: now + SNIPPET_CACHE_TTL_MS,
  })
}

export function mergeSnippetsInRequestOrder(
  requests: PendingSnippetRequest[],
  first: SnippetResponseItem[],
  second: SnippetResponseItem[]
): SnippetResponseItem[] {
  const byRequestId = new Map<string, SnippetResponseItem>()

  for (const snippet of first) {
    byRequestId.set(snippet.requestid, snippet)
  }

  for (const snippet of second) {
    byRequestId.set(snippet.requestid, snippet)
  }

  const merged: SnippetResponseItem[] = []
  for (const request of requests) {
    const match = byRequestId.get(request.requestid) || byRequestId.get(request.requestkey)
    if (!match) continue
    merged.push({
      ...match,
      requestid: request.requestid,
    })
  }

  return merged
}

export function resolveProviderCandidates(clientGeminiKey: string): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = []

  const groqKey = (process.env.GROQ_API_KEY || '').trim()
  const geminiEnvKey = (process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim()
  const geminiKey = clientGeminiKey || geminiEnvKey

  if (groqKey) {
    candidates.push({
      provider: 'groq',
      key: groqKey,
      rateLimitKey: buildProviderRateLimitKey('groq', groqKey),
    })
  }

  if (geminiKey) {
    candidates.push({
      provider: 'gemini',
      key: geminiKey,
      rateLimitKey: buildProviderRateLimitKey('gemini', geminiKey),
    })
  }

  return candidates
}

export function getAvailableProviderCandidates(candidates: ProviderCandidate[], now: number): ProviderCandidate[] {
  return candidates.filter((candidate) => {
    const until = rateLimitUntilByProvider.get(candidate.rateLimitKey)
    return !until || until <= now
  })
}

export function getMinimumProviderRetryMs(candidates: ProviderCandidate[], now: number): number | null {
  let minRetry: number | null = null

  for (const candidate of candidates) {
    const until = rateLimitUntilByProvider.get(candidate.rateLimitKey)
    if (!until || until <= now) continue

    const remaining = until - now
    if (remaining <= 0) continue
    if (minRetry === null || remaining < minRetry) {
      minRetry = remaining
    }
  }

  return minRetry
}

export function markProviderRateLimited(candidate: ProviderCandidate, retryAfterMs: number, now = Date.now()) {
  rateLimitUntilByProvider.set(candidate.rateLimitKey, now + retryAfterMs)
}

export function pruneCaches(now: number) {
  if (snippetCache.size > 500) {
    for (const [key, value] of snippetCache.entries()) {
      if (value.expiresAt <= now) snippetCache.delete(key)
    }
  }

  for (const [key, until] of rateLimitUntilByProvider.entries()) {
    if (until <= now) rateLimitUntilByProvider.delete(key)
  }
}

export async function generateAiSnippets(
  candidate: ProviderCandidate,
  requests: PendingSnippetRequest[]
): Promise<SnippetResponseItem[]> {
  if (candidate.provider === 'groq') {
    return generateGroqSnippets(candidate.key, requests)
  }

  return generateGeminiSnippets(candidate.key, requests)
}

export function isRateLimitError(message: string): boolean {
  return (
    message.includes('rate limit') ||
    message.includes('resource_exhausted') ||
    message.includes('quota') ||
    message.includes('too many requests') ||
    message.includes('429')
  )
}

export function isInvalidApiKeyError(message: string): boolean {
  return (
    message.includes('api key') && message.includes('invalid') ||
    message.includes('api key not valid') ||
    message.includes('api_key_invalid') ||
    message.includes('permission denied') ||
    message.includes('unauthorized') ||
    message.includes('401')
  )
}

export function extractRetryAfterMs(message: string): number | null {
  const match = message.match(/retry(?:\s+\w+)*\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds|m|min|minutes)?/)
  if (!match) return null

  const rawValue = Number(match[1])
  if (!Number.isFinite(rawValue) || rawValue <= 0) return null

  const unit = (match[2] || 's').toLowerCase()
  if (unit === 'ms') return Math.ceil(rawValue)
  if (unit === 'm' || unit === 'min' || unit === 'minutes') return Math.ceil(rawValue * 60_000)
  return Math.ceil(rawValue * 1000)
}

async function generateGeminiSnippets(
  apiKey: string,
  requests: PendingSnippetRequest[]
): Promise<SnippetResponseItem[]> {
  const modelProvider = createGoogleGenerativeAI({ apiKey })
  const prompt = buildPrompt(requests)
  const result = await withTimeout(
    generateObject({
      model: modelProvider(GEMINI_SNIPPETS_MODEL),
      schema: SnippetSchema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 2,
      prompt,
    }),
    AI_TIMEOUT_MS,
    `Snippet generation timed out after ${Math.ceil(AI_TIMEOUT_MS / 1000)}s`
  )

  return result.object.snippets
    .map((snippet) => ({
      requestid: truncate(snippet.requestid, 64),
      snippet: truncate(snippet.snippet, 180),
      riskLevel: snippet.riskLevel,
      source: 'ai' as const,
    }))
    .filter((snippet) => snippet.requestid && snippet.snippet)
    .map((snippet) => {
      const request = requests.find((item) => item.requestid === snippet.requestid || item.requestkey === snippet.requestid)
      if (!request) return snippet

      return {
        ...snippet,
        snippet: normalizeAiSnippetText(snippet.snippet, request, snippet.riskLevel),
      }
    })
}

async function generateGroqSnippets(
  apiKey: string,
  requests: PendingSnippetRequest[]
): Promise<SnippetResponseItem[]> {
  const userPrompt = buildPrompt(requests)
  const systemPrompt = [
    'You are assisting an access approver.',
    'Return JSON only.',
    'Use exactly this shape:',
    '{"snippets":[{"requestid":"<exact requestid from input>","snippet":"string","riskLevel":"low|medium|high"}]}',
    'No markdown. No prose. No code fences.',
    'Return one snippet object for every input request.',
    'Snippet length must be 16 words or less.',
  ].join(' ')

  const response = await withTimeout(
    fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_INSIGHTS_MODEL,
        temperature: 0.1,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    }),
    AI_TIMEOUT_MS,
    `Snippet generation timed out after ${Math.ceil(AI_TIMEOUT_MS / 1000)}s`
  )

  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`Groq API error ${response.status}: ${details || response.statusText}`)
  }

  const payload: unknown = await response.json().catch(() => null)
  const content = extractGroqContent(payload)
  if (!content) {
    throw new Error('Groq response did not include completion content.')
  }

  const parsed = parseJsonLike(content)
  if (!parsed) {
    throw new Error('Groq response was not valid JSON.')
  }

  const normalized = normalizeGroqSnippets(parsed, requests)
  if (normalized.length > 0) return normalized

  const strict = SnippetSchema.safeParse(parsed)
  if (strict.success) {
    return strict.data.snippets
      .map((snippet) => ({
        requestid: truncate(snippet.requestid, 64),
        snippet: truncate(snippet.snippet, 180),
        riskLevel: snippet.riskLevel,
        source: 'ai' as const,
      }))
      .filter((snippet) => snippet.requestid && snippet.snippet)
      .map((snippet) => {
        const request = requests.find((item) => item.requestid === snippet.requestid || item.requestkey === snippet.requestid)
        if (!request) return snippet

        return {
          ...snippet,
          snippet: normalizeAiSnippetText(snippet.snippet, request, snippet.riskLevel),
        }
      })
  }

  throw new Error('Groq response JSON did not match expected snippet schema.')
}

function buildProviderRateLimitKey(provider: SnippetProvider, key: string): string {
  return `${provider}:${fingerprintKey(key)}`
}

function fingerprintKey(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

function extractGroqContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return ''
  }

  const firstChoice = payload.choices[0]
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) return ''

  const content = firstChoice.message.content
  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    const textParts = content
      .map((part) => {
        if (!isRecord(part)) return ''
        return typeof part.text === 'string' ? part.text : ''
      })
      .filter(Boolean)
    return textParts.join('\n')
  }

  return ''
}

function parseJsonLike(value: string): unknown | null {
  const raw = value.trim()
  if (!raw) return null

  const direct = safeParseJson(raw)
  if (direct !== null) return direct

  const withoutFences = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const fenceParsed = safeParseJson(withoutFences)
  if (fenceParsed !== null) return fenceParsed

  const extracted = extractFirstJsonObject(withoutFences)
  if (!extracted) return null

  return safeParseJson(extracted)
}

function normalizeGroqSnippets(
  parsed: unknown,
  requests: PendingSnippetRequest[]
): SnippetResponseItem[] {
  const requestOrder = requests.map((request) => request.requestid)
  const requestById = new Map<string, PendingSnippetRequest>()
  for (const request of requests) {
    requestById.set(request.requestid, request)
    if (request.requestkey) requestById.set(request.requestkey, request)
  }

  const candidates = extractSnippetCandidates(parsed)
  const normalized: SnippetResponseItem[] = []

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    if (!isRecord(candidate)) continue

    const requestidRaw = firstNonEmptyString(
      candidate.requestid,
      candidate.requestKey,
      candidate.request_key,
      candidate.id,
      candidate.key
    )
    const requestFromModel =
      requestidRaw && requestById.has(requestidRaw)
        ? requestById.get(requestidRaw)
        : undefined
    const fallbackRequest = requests[index]
    const targetRequest = requestFromModel || fallbackRequest
    if (!targetRequest) continue

    const rawSnippet = truncate(
      firstNonEmptyString(
        candidate.snippet,
        candidate.reviewSnippet,
        candidate.review_snippet,
        candidate.reviewInsight,
        candidate.review_insight,
        candidate.insight,
        candidate.comment,
        candidate.text,
        candidate.reason
      ),
      180
    )
    if (!rawSnippet) continue

    const riskLevel = normalizeRiskLevel(
      firstNonEmptyString(
        candidate.riskLevel,
        candidate.risk_level,
        candidate.risk,
        candidate.level,
        candidate.severity
      ),
      rawSnippet,
      targetRequest
    )

    const snippet = normalizeAiSnippetText(rawSnippet, targetRequest, riskLevel)

    normalized.push({
      requestid: targetRequest.requestid,
      snippet,
      riskLevel,
      source: 'ai',
    })
  }

  if (normalized.length > 0) {
    return dedupeAndOrderSnippets(normalized, requestOrder)
  }

  if (isRecord(parsed)) {
    const mapped = extractMappedSnippets(parsed, requestById)
    if (mapped.length > 0) {
      return dedupeAndOrderSnippets(mapped, requestOrder)
    }
  }

  return []
}

function extractSnippetCandidates(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (!isRecord(parsed)) return []

  if (Array.isArray(parsed.snippets)) return parsed.snippets
  if (Array.isArray(parsed.items)) return parsed.items
  if (Array.isArray(parsed.insights)) return parsed.insights
  if (Array.isArray(parsed.results)) return parsed.results

  return []
}

function extractMappedSnippets(
  parsed: Record<string, unknown>,
  requestById: Map<string, PendingSnippetRequest>
): SnippetResponseItem[] {
  const items: SnippetResponseItem[] = []

  for (const [key, value] of Object.entries(parsed)) {
    const request = requestById.get(key)
    if (!request) continue

    if (typeof value === 'string' && value.trim()) {
      const riskLevel = inferRiskLevel(request)
      items.push({
        requestid: request.requestid,
        snippet: normalizeAiSnippetText(truncate(value.trim(), 180), request, riskLevel),
        riskLevel,
        source: 'ai',
      })
      continue
    }

    if (!isRecord(value)) continue

    const rawSnippet = truncate(
      firstNonEmptyString(
        value.snippet,
        value.reviewSnippet,
        value.review_snippet,
        value.insight,
        value.comment,
        value.text
      ),
      180
    )
    if (!rawSnippet) continue

    const riskLevel = normalizeRiskLevel(
      firstNonEmptyString(value.riskLevel, value.risk_level, value.risk, value.level, value.severity),
      rawSnippet,
      request
    )
    const snippet = normalizeAiSnippetText(rawSnippet, request, riskLevel)

    items.push({
      requestid: request.requestid,
      snippet,
      riskLevel,
      source: 'ai',
    })
  }

  return items
}

function safeParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function extractFirstJsonObject(value: string): string | null {
  const start = value.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < value.length; index += 1) {
    const char = value[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return value.slice(start, index + 1)
      }
    }
  }

  return null
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  if (timeoutMs <= 0) return promise

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
