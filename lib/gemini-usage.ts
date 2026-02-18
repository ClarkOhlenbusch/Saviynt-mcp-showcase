export const GEMINI_FLASH_3_PREVIEW_MODEL = 'gemini-3-flash-preview'
export const GEMINI_SNIPPETS_MODEL = 'gemini-2.5-flash-lite'

const DEFAULT_FREE_TIER_LIMITS = {
  rpm: 10,
  tpm: 250_000,
  rpd: 250,
} as const

const PACIFIC_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

// Free-tier limits can vary by project/account. Override with NEXT_PUBLIC_* values
// if your AI Studio usage dashboard shows different numbers.
export const GEMINI_FLASH_3_PREVIEW_FREE_LIMITS = Object.freeze({
  rpm: parseLimit(process.env.NEXT_PUBLIC_GEMINI_FLASH3_FREE_RPM, DEFAULT_FREE_TIER_LIMITS.rpm),
  tpm: parseLimit(process.env.NEXT_PUBLIC_GEMINI_FLASH3_FREE_TPM, DEFAULT_FREE_TIER_LIMITS.tpm),
  rpd: parseLimit(process.env.NEXT_PUBLIC_GEMINI_FLASH3_FREE_RPD, DEFAULT_FREE_TIER_LIMITS.rpd),
})

export type GeminiUsageTotals = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type GeminiMessageMetadata = {
  model: string
  usage: GeminiUsageTotals
  usageUpdatedAt: number
  usageIsFinal: boolean
}

export type GeminiUsageEvent = GeminiUsageTotals & {
  timestamp: number
}

export type GeminiUsageSnapshot = GeminiUsageTotals & {
  minuteTokens: number
  minuteRequests: number
  dayRequests: number
  limits: {
    rpm: number
    tpm: number
    rpd: number
  }
}

export function getPacificDayKey(timestamp: number): string {
  return PACIFIC_DAY_FORMATTER.format(timestamp)
}

export function createGeminiUsageSnapshot(
  events: GeminiUsageEvent[],
  now = Date.now(),
): GeminiUsageSnapshot {
  const minuteWindowStart = now - 60_000
  const dayKey = getPacificDayKey(now)

  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let minuteTokens = 0
  let minuteRequests = 0
  let dayRequests = 0

  for (const event of events) {
    inputTokens += event.inputTokens
    outputTokens += event.outputTokens
    totalTokens += event.totalTokens

    if (event.timestamp >= minuteWindowStart) {
      // Gemini TPM is defined as input tokens per minute.
      minuteTokens += event.inputTokens
      minuteRequests += 1
    }

    if (getPacificDayKey(event.timestamp) === dayKey) {
      dayRequests += 1
    }
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    minuteTokens,
    minuteRequests,
    dayRequests,
    limits: GEMINI_FLASH_3_PREVIEW_FREE_LIMITS,
  }
}
