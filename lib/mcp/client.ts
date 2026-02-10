import type { McpToolSchema, McpConnectionStatus, McpToolCallResult, McpServerConfig } from './types'

/**
 * MCP Client that connects to a Saviynt MCP server via HTTP JSON-RPC.
 * Config (server URL + auth header) is passed in at runtime from the UI
 * so there is no dependency on environment variables.
 */

// In-memory cache per server URL
let cachedTools: McpToolSchema[] = []
let cachedConfig: McpServerConfig | null = null
let connectionStatus: McpConnectionStatus = {
  connected: false,
  serverUrl: '',
  toolCount: 0,
}

function getHeaders(config: McpServerConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(config.authHeader ? { Authorization: config.authHeader } : {}),
  }
}

export async function connectToMcp(config: McpServerConfig): Promise<McpConnectionStatus> {
  if (!config.serverUrl) {
    connectionStatus = {
      connected: false,
      serverUrl: '',
      toolCount: 0,
      error: 'No server URL provided.',
    }
    return connectionStatus
  }

  cachedConfig = config

  try {
    const tools = await discoverTools(config)
    connectionStatus = {
      connected: true,
      serverUrl: config.serverUrl,
      toolCount: tools.length,
      lastConnected: Date.now(),
    }
    cachedTools = tools
    return connectionStatus
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown connection error'
    connectionStatus = {
      connected: false,
      serverUrl: config.serverUrl,
      toolCount: 0,
      error: errorMessage,
    }
    return connectionStatus
  }
}

export async function discoverTools(config?: McpServerConfig): Promise<McpToolSchema[]> {
  const c = config || cachedConfig
  if (!c) throw new Error('No MCP config available. Connect first.')

  const { serverUrl } = c
  const headers = getHeaders(c)

  // Strategy 1: JSON-RPC tools/list
  try {
    const rpcResponse = await fetch(`${serverUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      }),
    })
    if (rpcResponse.ok) {
      const rpcData = await rpcResponse.json()
      if (rpcData.result?.tools) {
        cachedTools = rpcData.result.tools.map((t: Record<string, unknown>) => ({
          name: t.name as string,
          description: t.description as string | undefined,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        }))
        return cachedTools
      }
    }
  } catch {
    // fall through to next strategy
  }

  // Strategy 2: REST GET /mcp/tools
  try {
    const response = await fetch(`${serverUrl}/mcp/tools`, {
      method: 'GET',
      headers,
    })
    if (response.ok) {
      const data = await response.json()
      const tools = Array.isArray(data) ? data : data.tools || []
      cachedTools = tools.map((t: Record<string, unknown>) => ({
        name: t.name as string,
        description: t.description as string | undefined,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      }))
      return cachedTools
    }
  } catch {
    // fall through
  }

  throw new Error(`Could not discover tools from ${serverUrl}. Tried JSON-RPC and REST endpoints.`)
}

export async function callTool(
  toolName: string,
  args: Record<string, unknown>,
  config?: McpServerConfig,
): Promise<McpToolCallResult> {
  const c = config || cachedConfig
  if (!c) {
    return {
      toolName,
      args,
      result: null,
      duration: 0,
      success: false,
      error: 'No MCP config available. Connect first.',
      timestamp: Date.now(),
    }
  }

  const { serverUrl } = c
  const headers = getHeaders(c)
  const startTime = Date.now()

  try {
    const response = await fetch(`${serverUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
        id: Date.now(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Tool call failed with status ${response.status}`)
    }

    const data = await response.json()
    const duration = Date.now() - startTime

    if (data.error) {
      return {
        toolName,
        args,
        result: null,
        duration,
        success: false,
        error: data.error.message || 'Tool call returned an error',
        timestamp: Date.now(),
      }
    }

    return {
      toolName,
      args,
      result: data.result?.content || data.result || data,
      duration,
      success: true,
      timestamp: Date.now(),
    }
  } catch (err) {
    const duration = Date.now() - startTime
    return {
      toolName,
      args,
      result: null,
      duration,
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      timestamp: Date.now(),
    }
  }
}

export function getConnectionStatus(): McpConnectionStatus {
  return connectionStatus
}

export function getCachedTools(): McpToolSchema[] {
  return cachedTools
}

export function getCachedConfig(): McpServerConfig | null {
  return cachedConfig
}
