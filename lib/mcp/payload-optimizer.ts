export interface PayloadCompactionLimits {
  maxArrayItems: number
  maxObjectKeys: number
  maxStringChars: number
  maxDepth: number
  targetBytes: number
}

export interface PayloadCompactionProfile {
  rawBytes: number
  compactedBytes: number
  reductionBytes: number
  reductionPercent: number
  arraysTruncated: number
  arrayItemsDropped: number
  objectsTrimmed: number
  objectKeysDropped: number
  stringsTruncated: number
  stringCharsDropped: number
  maxDepthHits: number
  attempts: number
  limits: PayloadCompactionLimits
}

type MutableProfileCounters = {
  arraysTruncated: number
  arrayItemsDropped: number
  objectsTrimmed: number
  objectKeysDropped: number
  stringsTruncated: number
  stringCharsDropped: number
  maxDepthHits: number
}

const DEFAULT_LIMITS: PayloadCompactionLimits = {
  maxArrayItems: parsePositiveInt(process.env.MCP_COMPACT_MAX_ARRAY_ITEMS, 40),
  maxObjectKeys: parsePositiveInt(process.env.MCP_COMPACT_MAX_OBJECT_KEYS, 60),
  maxStringChars: parsePositiveInt(process.env.MCP_COMPACT_MAX_STRING_CHARS, 1200),
  maxDepth: parsePositiveInt(process.env.MCP_COMPACT_MAX_DEPTH, 6),
  targetBytes: parsePositiveInt(process.env.MCP_COMPACT_TARGET_BYTES, 80_000),
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function estimatePayloadBytes(value: unknown): number {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    return new TextEncoder().encode(serialized).length
  } catch {
    return 0
  }
}

function compactValue(
  value: unknown,
  limits: PayloadCompactionLimits,
  profile: MutableProfileCounters,
  depth: number,
): unknown {
  if (value == null) return value

  if (depth >= limits.maxDepth) {
    profile.maxDepthHits += 1
    if (Array.isArray(value)) return value.slice(0, 0)
    if (typeof value === 'object') return { _truncated: 'max_depth' }
    if (typeof value === 'string') return value.slice(0, limits.maxStringChars)
    return value
  }

  if (typeof value === 'string') {
    if (value.length <= limits.maxStringChars) return value
    profile.stringsTruncated += 1
    profile.stringCharsDropped += value.length - limits.maxStringChars
    return `${value.slice(0, limits.maxStringChars)}... [truncated]`
  }

  if (Array.isArray(value)) {
    const keptCount = Math.min(value.length, limits.maxArrayItems)
    if (value.length > keptCount) {
      profile.arraysTruncated += 1
      profile.arrayItemsDropped += value.length - keptCount
    }
    return value.slice(0, keptCount).map((item) => compactValue(item, limits, profile, depth + 1))
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const keptCount = Math.min(entries.length, limits.maxObjectKeys)

    if (entries.length > keptCount) {
      profile.objectsTrimmed += 1
      profile.objectKeysDropped += entries.length - keptCount
    }

    const compacted: Record<string, unknown> = {}
    for (const [key, nested] of entries.slice(0, keptCount)) {
      compacted[key] = compactValue(nested, limits, profile, depth + 1)
    }
    return compacted
  }

  return value
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function tryParseJsonLike(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return text
  const startsLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[')
  if (!startsLikeJson) return text
  try {
    return JSON.parse(trimmed)
  } catch {
    return text
  }
}

function normalizeMcpPayload(value: unknown): unknown {
  if (typeof value === 'string') {
    return tryParseJsonLike(value)
  }

  if (!Array.isArray(value)) return value

  // Common MCP shape: [{ type: 'text', text: '...json...' }]
  const textParts = value.map((item) => {
    const record = toRecord(item)
    if (!record) return null
    const type = typeof record.type === 'string' ? record.type : undefined
    const text = typeof record.text === 'string' ? record.text : undefined
    if (type !== 'text' || text == null) return null
    return text
  })

  if (textParts.some((part) => part == null)) return value

  const normalized = textParts.map((text) => tryParseJsonLike(text!))
  if (normalized.length === 1) return normalized[0]
  return normalized
}

function tightenLimits(limits: PayloadCompactionLimits): PayloadCompactionLimits {
  return {
    maxArrayItems: Math.max(8, Math.floor(limits.maxArrayItems * 0.6)),
    maxObjectKeys: Math.max(16, Math.floor(limits.maxObjectKeys * 0.7)),
    maxStringChars: Math.max(300, Math.floor(limits.maxStringChars * 0.65)),
    maxDepth: Math.max(3, limits.maxDepth - 1),
    targetBytes: limits.targetBytes,
  }
}

export function compactMcpPayload(
  payload: unknown,
  overrides?: Partial<PayloadCompactionLimits>,
): { data: unknown; profile: PayloadCompactionProfile } {
  const baseLimits: PayloadCompactionLimits = { ...DEFAULT_LIMITS, ...overrides }
  const rawBytes = estimatePayloadBytes(payload)
  const normalizedPayload = normalizeMcpPayload(payload)

  let attempts = 0
  let activeLimits = baseLimits
  let lastData: unknown = normalizedPayload
  let lastCounters: MutableProfileCounters = {
    arraysTruncated: 0,
    arrayItemsDropped: 0,
    objectsTrimmed: 0,
    objectKeysDropped: 0,
    stringsTruncated: 0,
    stringCharsDropped: 0,
    maxDepthHits: 0,
  }

  while (attempts < 4) {
    attempts += 1
    const counters: MutableProfileCounters = {
      arraysTruncated: 0,
      arrayItemsDropped: 0,
      objectsTrimmed: 0,
      objectKeysDropped: 0,
      stringsTruncated: 0,
      stringCharsDropped: 0,
      maxDepthHits: 0,
    }
    const compacted = compactValue(normalizedPayload, activeLimits, counters, 0)
    const compactedBytes = estimatePayloadBytes(compacted)

    lastData = compacted
    lastCounters = counters

    if (compactedBytes <= activeLimits.targetBytes) {
      break
    }

    activeLimits = tightenLimits(activeLimits)
  }

  const compactedBytes = estimatePayloadBytes(lastData)
  const reductionBytes = Math.max(0, rawBytes - compactedBytes)
  const reductionPercent = rawBytes > 0
    ? Number(((reductionBytes / rawBytes) * 100).toFixed(1))
    : 0

  return {
    data: lastData,
    profile: {
      rawBytes,
      compactedBytes,
      reductionBytes,
      reductionPercent,
      arraysTruncated: lastCounters.arraysTruncated,
      arrayItemsDropped: lastCounters.arrayItemsDropped,
      objectsTrimmed: lastCounters.objectsTrimmed,
      objectKeysDropped: lastCounters.objectKeysDropped,
      stringsTruncated: lastCounters.stringsTruncated,
      stringCharsDropped: lastCounters.stringCharsDropped,
      maxDepthHits: lastCounters.maxDepthHits,
      attempts,
      limits: activeLimits,
    },
  }
}

export function describePayloadShape(payload: unknown): string {
  if (payload == null) return 'null'
  if (typeof payload === 'string') return `string(${payload.length})`
  if (typeof payload === 'number') return 'number'
  if (typeof payload === 'boolean') return 'boolean'
  if (Array.isArray(payload)) return `array(len=${payload.length})`
  if (typeof payload === 'object') {
    const keys = Object.keys(payload as Record<string, unknown>)
    const sample = keys.slice(0, 6).join(', ')
    return `object(keys=${keys.length}${sample ? `, sample=[${sample}]` : ''})`
  }
  return typeof payload
}
