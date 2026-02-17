import type { convertToModelMessages } from 'ai'
import type { GeminiUsageTotals } from '@/lib/gemini-usage'
import { asString, estimatePayloadBytes, isRecord, truncateText } from './chat-shared'

type ModelInputMessages = Parameters<typeof convertToModelMessages>[0]
type ModelInputMessage = ModelInputMessages[number]

export type PendingRequestSnapshot = {
  requestid: string
  requestkey: string
  requestedfor: string
  requesttype: string
  duedate: string
  endpoint: string
}

type BuildContextMessagesOptions = {
  maxMessages: number
  maxBytes: number
  fullFidelityMessages: number
  maxHistoricalAssistantChars: number
}

export function normalizePendingRequestsSnapshot(value: unknown, maxItems: number): PendingRequestSnapshot[] {
  if (!Array.isArray(value)) return []

  const normalized: PendingRequestSnapshot[] = []

  for (const item of value) {
    if (!isRecord(item)) continue

    const requestid = truncateText(asString(item.requestid), 64)
    const requestkey = truncateText(asString(item.requestkey), 128)
    if (!requestid && !requestkey) continue

    normalized.push({
      requestid: requestid || requestkey || 'N/A',
      requestkey: requestkey || requestid || '',
      requestedfor: truncateText(asString(item.requestedfor) || 'Unknown User', 120),
      requesttype: truncateText(asString(item.requesttype) || 'Access Request', 120),
      duedate: truncateText(asString(item.duedate), 40),
      endpoint: truncateText(asString(item.endpoint), 120),
    })
  }

  return normalized.slice(0, maxItems)
}

export function buildContextMessages(
  messages: unknown,
  options: BuildContextMessagesOptions
): ModelInputMessages {
  if (!Array.isArray(messages)) return []

  const normalized = messages
    .map((message) => toModelInputMessage(message))
    .filter((message): message is ModelInputMessage => message !== null)

  if (normalized.length === 0) return []

  const selected: ModelInputMessage[] = []
  let usedBytes = 0

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index]
    const distanceFromLatest = normalized.length - 1 - index
    const preserveFullMessage = distanceFromLatest < options.fullFidelityMessages
    const candidate = preserveFullMessage
      ? message
      : slimHistoricalAssistantMessage(message, options.maxHistoricalAssistantChars)
    const candidateBytes = estimatePayloadBytes(candidate)

    if (selected.length === 0) {
      selected.push(candidate)
      usedBytes += candidateBytes
      continue
    }

    if (selected.length >= options.maxMessages) continue
    if (usedBytes + candidateBytes > options.maxBytes) continue

    selected.push(candidate)
    usedBytes += candidateBytes
  }

  return selected.reverse()
}

export function normalizeUsageTotals(usage: {
  inputTokens: number | undefined
  outputTokens: number | undefined
  totalTokens: number | undefined
}): GeminiUsageTotals {
  const inputTokens = Math.max(0, usage.inputTokens ?? 0)
  const outputTokens = Math.max(0, usage.outputTokens ?? 0)
  const totalTokens = Math.max(0, usage.totalTokens ?? inputTokens + outputTokens)

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  }
}

export function addUsageTotals(a: GeminiUsageTotals, b: GeminiUsageTotals): GeminiUsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

export function isUsageLimitError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('quota') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('resource_exhausted') ||
    normalized.includes('limit exceeded') ||
    normalized.includes('429')
  )
}

export function isInvalidApiKeyError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('api key not valid') ||
    normalized.includes('invalid api key') ||
    normalized.includes('invalid api-key') ||
    normalized.includes('api_key_invalid') ||
    normalized.includes('credential is not valid')
  )
}

function toModelInputMessage(value: unknown): ModelInputMessage | null {
  if (!isRecord(value)) return null
  if (typeof value.role !== 'string' || !Array.isArray(value.parts)) return null

  const { id: _id, ...rest } = value
  return rest as ModelInputMessage
}

function slimHistoricalAssistantMessage(
  message: ModelInputMessage,
  maxHistoricalAssistantChars: number
): ModelInputMessage {
  if (message.role !== 'assistant' || !Array.isArray(message.parts)) {
    return message
  }

  const textParts = message.parts
    .filter((part): part is { type: 'text'; text: string } => isRecord(part) && part.type === 'text' && typeof part.text === 'string')
    .map((part) => ({
      ...part,
      text: truncateText(part.text, maxHistoricalAssistantChars),
    }))

  if (textParts.length === 0) {
    return {
      ...message,
      parts: [{
        type: 'text',
        text: '[Prior tool output omitted to preserve context budget.]',
      }] as ModelInputMessage['parts'],
    }
  }

  return {
    ...message,
    parts: textParts as ModelInputMessage['parts'],
  }
}
