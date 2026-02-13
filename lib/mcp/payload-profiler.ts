import type { PayloadCompactionProfile } from './payload-optimizer'

export interface McpPayloadProfileEvent {
  id: string
  timestamp: number
  toolName: string
  phase: 'single' | 'parallel'
  payloadShape: string
  payloadPreview: string
  profile: PayloadCompactionProfile
}

const MAX_EVENTS = 250
const events: McpPayloadProfileEvent[] = []

export function recordMcpPayloadProfile(
  input: Omit<McpPayloadProfileEvent, 'id' | 'timestamp'> & { timestamp?: number },
): McpPayloadProfileEvent {
  const entry: McpPayloadProfileEvent = {
    id: `payload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: input.timestamp ?? Date.now(),
    toolName: input.toolName,
    phase: input.phase,
    payloadShape: input.payloadShape,
    payloadPreview: input.payloadPreview,
    profile: input.profile,
  }

  events.push(entry)
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS)
  }

  return entry
}

export function getRecentMcpPayloadProfiles(limit = 50): McpPayloadProfileEvent[] {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)))
  return events.slice(-safeLimit).reverse()
}
