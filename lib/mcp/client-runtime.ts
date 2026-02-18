import type {
  McpConnectionStatus,
  McpServerConfig,
  McpToolSchema,
} from './types'

export type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void
  reject: (reason: unknown) => void
}

export type PendingRequestMap = Map<string, PendingRequest>

export type McpClientRuntime = {
  cachedTools: McpToolSchema[]
  cachedConfig: McpServerConfig | null
  connectionStatus: McpConnectionStatus
  sseReader: ReadableStreamDefaultReader<Uint8Array> | null
  sseMessageEndpoint: string | null
  sseAbortController: AbortController | null
  connectInFlight: Promise<McpConnectionStatus> | null
}

export function createMcpClientRuntime(): McpClientRuntime {
  return {
    cachedTools: [],
    cachedConfig: null,
    connectionStatus: {
      connected: false,
      serverUrl: '',
      toolCount: 0,
    },
    sseReader: null,
    sseMessageEndpoint: null,
    sseAbortController: null,
    connectInFlight: null,
  }
}
