export interface McpToolSchema {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpToolCallResult {
  toolName: string
  args: Record<string, unknown>
  result: unknown
  duration: number
  success: boolean
  error?: string
  timestamp: number
}

export interface McpParallelToolCall {
  toolName: string
  args: Record<string, unknown>
}

export interface McpParallelToolCallResult {
  calls: McpToolCallResult[]
  success: boolean
  duration: number
  error?: string
  timestamp: number
}

export interface McpConnectionStatus {
  connected: boolean
  serverUrl: string
  toolCount: number
  error?: string
  lastConnected?: number
}

export interface McpServerConfig {
  serverUrl: string
  authHeader: string
}

export interface ToolTrace {
  id: string
  toolName: string
  args: Record<string, unknown>
  argsRedacted: Record<string, unknown>
  responsePreview: string
  duration: number
  success: boolean
  error?: string
  timestamp: number
}

export interface SessionLog {
  sessionId: string
  startTime: number
  toolCalls: ToolTrace[]
  messages: Array<{ role: string; content: string; timestamp: number }>
}

export interface Artifact {
  id: string
  title: string
  type: 'access-review' | 'sod-analysis' | 'onboarding-plan' | 'generic'
  markdown: string
  evidenceJson: Record<string, unknown>[]
  createdAt: number
}
