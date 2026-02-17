export type SnippetRiskLevel = 'low' | 'medium' | 'high'
export type SnippetSource = 'ai' | 'heuristic' | 'cache'
export type SnippetProvider = 'groq' | 'gemini'

export type PendingSnippetRequest = {
  requestid: string
  requestkey: string
  requestedfor: string
  requesttype: string
  endpoint: string
  duedate: string
  requestcomments: string
}

export type SnippetResponseItem = {
  requestid: string
  snippet: string
  riskLevel: SnippetRiskLevel
  source: SnippetSource
}

const MAX_REQUESTS = 12

export function normalizeRequests(value: unknown): PendingSnippetRequest[] {
  if (!Array.isArray(value)) return []

  const normalized: PendingSnippetRequest[] = []

  for (const item of value.slice(0, MAX_REQUESTS)) {
    if (!isRecord(item)) continue

    const requestid = firstNonEmptyString(item.requestid, item.requestkey, item.id, item.key)
    if (!requestid) continue

    normalized.push({
      requestid: truncate(requestid, 64),
      requestkey: truncate(firstNonEmptyString(item.requestkey, item.key, requestid), 64),
      requestedfor: truncate(firstNonEmptyString(item.requestedfor, item.firstname, 'Unknown User'), 120),
      requesttype: truncate(firstNonEmptyString(item.requesttype, 'Access Request'), 120),
      endpoint: truncate(firstNonEmptyString(item.endpoint, item.securitysystem), 120),
      duedate: truncate(firstNonEmptyString(item.duedate), 48),
      requestcomments: truncate(firstNonEmptyString(item.requestcomments, ''), 320),
    })
  }

  return normalized
}

export function buildPrompt(requests: PendingSnippetRequest[]): string {
  const lines: string[] = []
  lines.push('You are writing short triage insights for identity access reviewers.')
  lines.push('For each request, return one JSON snippet object and a risk level.')
  lines.push('Rules:')
  lines.push('- snippet must be 10-18 words and exactly one sentence')
  lines.push('- include one concrete verification step (ticket, manager, least-privilege, expiry, SoD)')
  lines.push('- include one risk cue tied to request type or target system')
  lines.push('- do NOT include due dates, request ids, or raw placeholder comment tokens')
  lines.push('- do NOT use placeholders like "N/A"')
  lines.push('- do NOT begin with Review/Assess/Validate/Check')
  lines.push('- no markdown, no bullets, no extra fields')
  lines.push('- base only on provided request metadata')
  lines.push('')
  lines.push('Requests:')

  for (const request of requests) {
    const endpoint = normalizeEndpointLabel(request.endpoint)
    const comment = summarizeCommentForPrompt(request.requestcomments)
    lines.push(
      `${request.requestid} | ${request.requestedfor} | ${request.requesttype} | resource: ${endpoint} | comment: ${comment}`
    )
  }

  return lines.join('\n')
}

export function buildFallbackSnippets(requests: PendingSnippetRequest[]): SnippetResponseItem[] {
  return requests.map((request) => {
    const riskLevel = inferRiskLevel(request)
    const snippet = buildInsightSnippet(request, riskLevel)

    return {
      requestid: request.requestid,
      snippet,
      riskLevel,
      source: 'heuristic' as const,
    }
  })
}

export function normalizeAiSnippetText(
  rawSnippet: string,
  request: PendingSnippetRequest,
  riskLevel: SnippetRiskLevel
): string {
  const endpoint = normalizeEndpointLabel(request.endpoint)
  const placeholderTokens = /\b(ActionableManager|IDProofingManager|EntraID_Manager)\b/gi

  let snippet = rawSnippet
    .replace(/\s+/g, ' ')
    .replace(/^[-*]\s+/, '')
    .replace(/`/g, '')
    .replace(/"+/g, '')
    .replace(placeholderTokens, '')
    .replace(/\bN\/A\b/gi, endpoint)
    .replace(/\bDue\s+[0-9\-/: ]+\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!snippet || isWeakAiSnippet(snippet)) {
    return buildInsightSnippet(request, riskLevel)
  }

  snippet = ensureSentence(snippet)
  return truncate(snippet, 180)
}

export function inferRiskLevel(request: PendingSnippetRequest, snippetText = ''): SnippetRiskLevel {
  const requestType = request.requesttype.toLowerCase()
  const endpoint = normalizeEndpointLabel(request.endpoint).toLowerCase()
  const comments = request.requestcomments.toLowerCase()
  const requestedFor = request.requestedfor.toLowerCase()
  const snippet = snippetText.toLowerCase()
  const source = `${requestType} ${endpoint} ${comments} ${requestedFor} ${snippet}`

  const hasPrivilegedCue =
    /(prod|production|privileged|admin|root|break[- ]?glass|sox|finance|sod|global access|all access|emergency access|superuser)/.test(source)
  const criticalSystem =
    /(active directory|aws|microsoft entraid|entra|okta|sap|oracle|salesforce|workday|servicenow|database)/.test(endpoint)
  const accountProvisioning = /(create user|new account|create account|onboard|provision)/.test(requestType)
  const accessGrant = /(grant access|entitlement|role|permission)/.test(requestType)
  const externalMailbox = /@/.test(requestedFor) && !/@saviynt\.com\b/.test(requestedFor)
  const disposableDomain = /(yopmail|mailinator|tempmail|guerrillamail)\b/.test(requestedFor)

  if (hasPrivilegedCue) return 'high'
  if ((accountProvisioning && criticalSystem) || disposableDomain) return 'high'
  if (accountProvisioning && externalMailbox) return 'high'

  if (
    accessGrant && criticalSystem ||
    accountProvisioning ||
    /(temporary access|elevated|vpn|service account|sensitive|contractor|payroll|security group|no comments)/.test(source)
  ) {
    return 'medium'
  }

  return 'low'
}

export function applyRiskFloor(
  modelRisk: SnippetRiskLevel,
  request: PendingSnippetRequest,
  snippetText = ''
): SnippetRiskLevel {
  const floor = inferRiskLevel(request, snippetText)
  return maxRiskLevel(modelRisk, floor)
}

export function normalizeRiskLevel(
  rawRiskLevel: string,
  snippet: string,
  request: PendingSnippetRequest
): SnippetRiskLevel {
  const normalized = `${rawRiskLevel}`.toLowerCase()

  if (normalized.includes('critical') || normalized.includes('high')) return 'high'
  if (normalized.includes('medium') || normalized.includes('moderate')) return 'medium'
  if (normalized.includes('low')) return 'low'

  // Model returned an unrecognizable risk level; fall back to heuristic
  return inferRiskLevel(request, snippet)
}

export function dedupeAndOrderSnippets(
  items: SnippetResponseItem[],
  requestOrder: string[]
): SnippetResponseItem[] {
  const seen = new Set<string>()
  const deduped: SnippetResponseItem[] = []

  for (const item of items) {
    if (!item.requestid || !item.snippet) continue
    if (seen.has(item.requestid)) continue
    seen.add(item.requestid)
    deduped.push(item)
  }

  const rank = new Map<string, number>()
  for (let index = 0; index < requestOrder.length; index += 1) {
    rank.set(requestOrder[index], index)
  }

  deduped.sort((a, b) => {
    const aRank = rank.get(a.requestid)
    const bRank = rank.get(b.requestid)
    if (aRank === undefined && bRank === undefined) return 0
    if (aRank === undefined) return 1
    if (bRank === undefined) return -1
    return aRank - bRank
  })

  return deduped
}

export function buildSnippetCacheKey(request: PendingSnippetRequest): string {
  return [
    request.requestid,
    request.requesttype,
    request.endpoint,
    request.duedate,
    request.requestcomments,
  ].join('|').toLowerCase()
}

export function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWeakAiSnippet(snippet: string): boolean {
  const normalized = snippet.toLowerCase()
  const wordCount = normalized.split(/\s+/).filter(Boolean).length

  if (wordCount < 8) return true
  if (wordCount > 26) return true
  if (/^(review|assess|validate|check)\b/.test(normalized)) return true
  if (normalized.includes('comment:')) return true
  if (normalized.includes(' due ')) return true
  if (normalized.includes('in n/a')) return true
  if (normalized.includes('risk cue:')) return true
  if (normalized.includes('concrete step:')) return true

  return false
}

function buildInsightSnippet(request: PendingSnippetRequest, riskLevel: SnippetRiskLevel): string {
  const endpoint = normalizeEndpointLabel(request.endpoint)
  const requestType = request.requesttype.toLowerCase()
  const comment = normalizeCommentForSnippet(request.requestcomments)

  let action = `Confirm business justification and least-privilege scope before approving access on ${endpoint}`

  if (/(new account|create user|create account|onboard)/.test(requestType)) {
    action = `Confirm onboarding ticket and manager approval; grant baseline access only on ${endpoint}`
  } else if (/(grant access|role|entitlement|permission)/.test(requestType)) {
    action = `Verify role necessity and least-privilege scope on ${endpoint}; reject broad standing access`
  } else if (/(remove|revoke|disable|terminate|deprovision)/.test(requestType)) {
    action = `Confirm deprovisioning intent and downstream impact before removing access on ${endpoint}`
  }

  let prefix = ''
  if (riskLevel === 'high') {
    prefix = `Privileged or sensitive access detected on ${endpoint}; `
  } else if (riskLevel === 'medium') {
    prefix = `Potentially sensitive access on ${endpoint}; `
  }

  let snippet = `${prefix}${action}`
  if (comment) {
    snippet += `; validate ticket note "${comment}"`
  }

  return truncate(ensureSentence(snippet), 180)
}

function normalizeEndpointLabel(endpoint: string): string {
  const normalized = endpoint.replace(/\s+/g, ' ').trim()
  if (!normalized) return 'target system'
  if (/^(n\/a|na|none|null|unknown)$/i.test(normalized)) return 'target system'
  return normalized
}

function summarizeCommentForPrompt(comment: string): string {
  const normalized = comment.replace(/\s+/g, ' ').trim()
  if (!normalized) return 'none'

  if (isPlaceholderComment(normalized)) {
    return 'none'
  }

  return truncate(normalized, 96)
}

function normalizeCommentForSnippet(comment: string): string {
  const normalized = comment.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (isPlaceholderComment(normalized)) return ''

  return truncate(normalized, 56)
}

function isPlaceholderComment(comment: string): boolean {
  const normalized = comment.toLowerCase()
  if (['n/a', 'na', 'none', 'null', 'manager'].includes(normalized)) return true
  if (/^(actionablemanager|idproofingmanager|entraid_manager)$/i.test(comment)) return true
  if (/^[a-z0-9_]{3,40}manager$/i.test(comment) && !comment.includes(' ')) return true

  return false
}

function ensureSentence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  if (/[.!?]$/.test(trimmed)) return trimmed
  return `${trimmed}.`
}

function maxRiskLevel(a: SnippetRiskLevel, b: SnippetRiskLevel): SnippetRiskLevel {
  const rank: Record<SnippetRiskLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
  }

  return rank[a] >= rank[b] ? a : b
}
