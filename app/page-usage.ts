import { useCallback, useEffect, useMemo, useState } from 'react'
import { createGeminiUsageSnapshot, type GeminiUsageEvent } from '@/lib/gemini-usage'

const GEMINI_USAGE_STORAGE_KEY = 'gemini_usage_events_v1'
const USAGE_EVENT_RETENTION_MS = 48 * 60 * 60 * 1000

function normalizeUsageEvent(value: unknown): GeminiUsageEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const event = value as Record<string, unknown>
  const inputTokens = typeof event.inputTokens === 'number' ? Math.max(0, Math.floor(event.inputTokens)) : 0
  const outputTokens = typeof event.outputTokens === 'number' ? Math.max(0, Math.floor(event.outputTokens)) : 0
  const totalTokensRaw = typeof event.totalTokens === 'number' ? Math.max(0, Math.floor(event.totalTokens)) : inputTokens + outputTokens
  const timestamp = typeof event.timestamp === 'number' ? Math.max(0, Math.floor(event.timestamp)) : 0

  if (!Number.isFinite(totalTokensRaw) || !Number.isFinite(timestamp) || timestamp <= 0) return null

  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokensRaw,
    timestamp,
  }
}

export function useGeminiUsage() {
  const [events, setEvents] = useState<GeminiUsageEvent[]>([])
  const [usageClock, setUsageClock] = useState(() => Date.now())

  const snapshot = useMemo(
    () => createGeminiUsageSnapshot(events, usageClock),
    [events, usageClock],
  )

  useEffect(() => {
    const raw = localStorage.getItem(GEMINI_USAGE_STORAGE_KEY)
    if (!raw) return

    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return

      const cutoff = Date.now() - USAGE_EVENT_RETENTION_MS
      const normalized = parsed
        .map((item) => normalizeUsageEvent(item))
        .filter((item): item is GeminiUsageEvent => item !== null && item.timestamp >= cutoff)

      setEvents(normalized)
    } catch {
      // Ignore malformed persisted data.
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(GEMINI_USAGE_STORAGE_KEY, JSON.stringify(events))
  }, [events])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setUsageClock(Date.now())
    }, 5000)

    return () => window.clearInterval(intervalId)
  }, [])

  const addEvent = useCallback((event: GeminiUsageEvent) => {
    setEvents((prev) => {
      const cutoff = Date.now() - USAGE_EVENT_RETENTION_MS
      const next = [...prev, event].filter((item) => item.timestamp >= cutoff)
      return next
    })
  }, [])

  return {
    snapshot,
    addEvent,
  }
}
