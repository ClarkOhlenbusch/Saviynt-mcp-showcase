import type { UIMessage } from 'ai'
import type { Artifact, McpPendingRequest } from '@/lib/mcp/types'
import type { GeminiMessageMetadata, GeminiUsageEvent } from '@/lib/gemini-usage'
import { ACCESS_REVIEW_PROMPTS, type DemoPromptCard } from '@/lib/agent/prompts'

const USAGE_LIMIT_PATTERNS = [
  /quota/i,
  /rate limit/i,
  /too many requests/i,
  /resource_exhausted/i,
  /limit exceeded/i,
  /\b429\b/i,
]

const MIN_SIGNIFICANT_DELIVERABLE_LENGTH = 320

const DELIVERABLE_KEYWORD_PATTERNS = [
  /\baccess review brief\b/i,
  /\bsod conflict/i,
  /\bseparation of duties\b/i,
  /\bonboarding (?:and )?provisioning plan\b/i,
  /\bprovisioning plan\b/i,
]

const DELIVERABLE_SECTION_PATTERNS = [
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?executive summary(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?scope(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?methodology(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?findings(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?recommendations(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?conflicts identified(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?remediation plan(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?baseline access bundle(?:\*\*)?\b/i,
  /(?:^|\n)\s*(?:#{1,3}\s+|\*\*)?approvals required(?:\*\*)?\b/i,
]

export const SUBMITTED_STATUS_MESSAGES = [
  'Connecting to the model...',
  'Thinking through your request...',
  'Preparing the first tool checks...',
  'Still working... tracing identity edges now.',
]

export type MessagePart = UIMessage['parts'][number]

type ToolMessagePart = MessagePart & {
  toolName?: unknown
  toolCallId?: unknown
  input?: unknown
  output?: unknown
  state?: unknown
  errorText?: unknown
  duration?: unknown
}

type ArtifactCandidate = {
  type: Artifact['type']
  title: string
  markdown: string
}

export function parseChatErrorMessage(error: Error | undefined): string {
  if (!error) return ''
  const rawMessage = (error.message || String(error)).trim()
  if (!rawMessage) return 'The request failed. Please try again.'

  const jsonStart = rawMessage.indexOf('{')
  const jsonEnd = rawMessage.lastIndexOf('}')
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart, jsonEnd + 1)) as {
        error?: string
        message?: string
      }
      if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
      if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message
    } catch {
      // Fallback to raw message.
    }
  }

  return rawMessage
}

export function isUsageLimitError(message: string): boolean {
  return USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))
}

export function extractAssistantText(parts: MessagePart[] | undefined): string {
  if (!Array.isArray(parts) || parts.length === 0) return ''
  return parts
    .filter((part): part is MessagePart & { type: 'text'; text: string } =>
      part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text.trimEnd())
    .filter((text) => text.length > 0)
    .join('\n\n')
    .trim()
}

export function isToolMessagePart(part: MessagePart): part is ToolMessagePart {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool'
}

export function toArtifactToolTrace(part: ToolMessagePart): Artifact['evidenceJson'][number] {
  const state = typeof part.state === 'string' ? part.state : 'input-available'
  const args = toRecord(part.input)

  return {
    id: typeof part.toolCallId === 'string' ? part.toolCallId : '',
    toolName: getToolName(part),
    args,
    argsRedacted: args,
    responsePreview:
      state === 'output-available'
        ? toPreview(part.output)
        : state === 'output-error'
          ? toPreview(part.errorText)
          : '',
    duration: typeof part.duration === 'number' ? part.duration : 0,
    success: state === 'output-available',
    timestamp: Date.now(),
  }
}

export function toGeminiUsageEvent(metadata: GeminiMessageMetadata | undefined): GeminiUsageEvent | null {
  if (!metadata?.usageIsFinal || !metadata.usage) return null

  const inputTokens = toSafeTokenCount(metadata.usage.inputTokens)
  const outputTokens = toSafeTokenCount(metadata.usage.outputTokens)
  const totalTokens = toSafeTokenCount(
    metadata.usage.totalTokens ?? inputTokens + outputTokens
  )

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    timestamp: Date.now(),
  }
}

export function assessArtifactCandidate(text: string): ArtifactCandidate | null {
  const normalized = text.trim()
  if (normalized.length < MIN_SIGNIFICANT_DELIVERABLE_LENGTH) return null

  const hasKeyword = DELIVERABLE_KEYWORD_PATTERNS.some((pattern) => pattern.test(normalized))
  const sectionMatches = DELIVERABLE_SECTION_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(normalized) ? 1 : 0),
    0
  )
  const hasTable = /\n\|.+\|/.test(normalized) && /\n\|[:\-\s|]+\|/.test(normalized)

  const significanceScore = (hasKeyword ? 2 : 0) + Math.min(sectionMatches, 4) + (hasTable ? 1 : 0)
  if (significanceScore < 3 && !(hasKeyword && normalized.length >= 500)) return null

  const type = inferArtifactType(normalized)
  const title = inferArtifactTitle(normalized, type)

  return {
    type,
    title,
    markdown: normalized,
  }
}

export function buildSelectedRequestPrompts(selectedRequest: McpPendingRequest): DemoPromptCard[] {
  const requestLabel = selectedRequest.requestid || selectedRequest.requestkey || 'this request'
  const requestedFor = selectedRequest.requestedfor || 'this user'
  const endpoint = selectedRequest.endpoint || selectedRequest.securitysystem || 'the requested system'

  return ACCESS_REVIEW_PROMPTS.map((prompt) => {
    if (prompt.id === 'review-risk') {
      return {
        ...prompt,
        prompt: `Assess risk for request ${requestLabel} (${requestedFor} -> ${endpoint}). Summarize top concerns, confidence level, and what evidence is still missing.`,
      }
    }

    if (prompt.id === 'review-evidence') {
      return {
        ...prompt,
        prompt: `For request ${requestLabel}, list the exact Saviynt checks we should run before deciding, and what approve vs reject evidence each check should produce.`,
      }
    }

    if (prompt.id === 'review-decision') {
      return {
        ...prompt,
        prompt: `Draft a decision recommendation for request ${requestLabel} (${requestedFor} requesting ${endpoint}). Include rationale, risk tradeoffs, and a concise reviewer note.`,
      }
    }

    return prompt
  })
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function getToolName(part: ToolMessagePart): string {
  if (part.type === 'dynamic-tool' && typeof part.toolName === 'string') {
    return part.toolName
  }
  return part.type.split('-').slice(1).join('-')
}

function toSafeTokenCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function toPreview(value: unknown, maxLength = 300): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.slice(0, maxLength)
  try {
    return JSON.stringify(value).slice(0, maxLength)
  } catch {
    return String(value).slice(0, maxLength)
  }
}

function inferArtifactType(text: string): Artifact['type'] {
  if (/sod|separation of duties/i.test(text)) return 'sod-analysis'
  if (/onboarding|provisioning/i.test(text)) return 'onboarding-plan'
  if (/access review/i.test(text)) return 'access-review'
  return 'generic'
}

function inferArtifactTitle(text: string, type: Artifact['type']): string {
  const titleLine = text.match(/(?:^|\n)\s{0,3}#{1,2}\s+(.+?)\s*(?=\n|$)/i)?.[1]?.trim()
  if (
    titleLine &&
    !/^executive summary$/i.test(titleLine) &&
    !/^findings$/i.test(titleLine) &&
    !/^scope$/i.test(titleLine)
  ) {
    return titleLine
  }

  if (type === 'access-review') return 'Access Review Brief'
  if (type === 'sod-analysis') return 'SoD Conflict Analysis'
  if (type === 'onboarding-plan') return 'Onboarding & Provisioning Plan'
  return 'Generated Report'
}
