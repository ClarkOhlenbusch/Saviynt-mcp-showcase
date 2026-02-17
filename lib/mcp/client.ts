import type {
  McpToolSchema,
  McpConnectionStatus,
  McpToolCallResult,
  McpServerConfig,
  McpParallelToolCall,
  McpParallelToolCallResult,
} from './types'
import { createMcpClientRuntime } from './client-runtime'
import {
  extractToolCallResult,
  extractTools,
  getRpcErrorMessage,
  isSameConfig,
  stableSerialize,
} from './client-helpers'
import {
  mcpRequest,
  openSSEConnection,
  resetConnection,
} from './client-transport'

const runtime = createMcpClientRuntime()
const pendingRequests = new Map<string, {
  resolve: (value: Record<string, unknown>) => void
  reject: (reason: unknown) => void
}>()

async function connectToMcpInternal(config: McpServerConfig): Promise<McpConnectionStatus> {
  if (!config.serverUrl) {
    runtime.connectionStatus = { connected: false, serverUrl: '', toolCount: 0, error: 'No server URL provided.' }
    return runtime.connectionStatus
  }

  const hasActiveSse = Boolean(runtime.sseReader && runtime.sseMessageEndpoint)
  if (runtime.connectionStatus.connected && hasActiveSse && isSameConfig(runtime.cachedConfig, config)) {
    return {
      ...runtime.connectionStatus,
      serverUrl: config.serverUrl,
    }
  }

  runtime.cachedConfig = config

  if (runtime.sseReader || runtime.sseMessageEndpoint) {
    resetConnection(runtime, pendingRequests, 'Reconnecting to MCP server', { cancelReader: true, rejectPending: true })
  }

  try {
    await openSSEConnection(runtime, pendingRequests, config.serverUrl, config)

    const toolsResponse = await mcpRequest(runtime, pendingRequests, 'tools/list', {}, 15000)
    const tools = extractTools(toolsResponse)

    runtime.cachedTools = tools
    runtime.connectionStatus = {
      connected: true,
      serverUrl: config.serverUrl,
      toolCount: tools.length,
      lastConnected: Date.now(),
    }

    console.log(`[MCP] Connected! Discovered ${tools.length} tools.`)
    return runtime.connectionStatus
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown connection error'
    console.error('[MCP] Connection failed:', errorMessage)
    resetConnection(runtime, pendingRequests, errorMessage, { cancelReader: true, rejectPending: true })
    runtime.connectionStatus = { connected: false, serverUrl: config.serverUrl, toolCount: 0, error: errorMessage }
    return runtime.connectionStatus
  }
}

export async function connectToMcp(config: McpServerConfig): Promise<McpConnectionStatus> {
  if (runtime.connectInFlight) {
    console.log('[MCP] Awaiting in-flight connection attempt...')
    return runtime.connectInFlight
  }

  runtime.connectInFlight = connectToMcpInternal(config)
    .finally(() => {
      runtime.connectInFlight = null
    })

  return runtime.connectInFlight
}

export async function discoverTools(config?: McpServerConfig): Promise<McpToolSchema[]> {
  const c = config || runtime.cachedConfig
  if (!c) throw new Error('No MCP config available')

  if (runtime.sseMessageEndpoint && runtime.sseReader) {
    const toolsResponse = await mcpRequest(runtime, pendingRequests, 'tools/list', {}, 15000)
    const tools = extractTools(toolsResponse)
    runtime.cachedTools = tools
    return tools
  }

  await connectToMcp(c)
  return runtime.cachedTools
}

export async function callTool(
  toolName: string,
  args: Record<string, unknown>,
  config?: McpServerConfig
): Promise<McpToolCallResult> {
  const c = config || runtime.cachedConfig
  if (!c) throw new Error('No MCP config available')

  const startTime = Date.now()
  const maxRetries = 2

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (!runtime.sseReader || !runtime.sseMessageEndpoint) {
      if (attempt === 0) {
        console.log('[MCP] No active SSE connection for tool call, connecting...')
      } else {
        console.log(`[MCP] SSE connection dropped, reconnecting (attempt ${attempt + 1}/${maxRetries + 1})...`)
      }
      await connectToMcp(c)
      if (!runtime.sseReader || !runtime.sseMessageEndpoint) {
        return {
          toolName,
          args,
          result: null,
          duration: Date.now() - startTime,
          success: false,
          error: 'Failed to establish SSE connection to MCP server',
          timestamp: Date.now(),
        }
      }
    }

    try {
      console.log(`[MCP] Calling tool: ${toolName} (attempt ${attempt + 1}/${maxRetries + 1})`)
      const rpcData = await mcpRequest(runtime, pendingRequests, 'tools/call', { name: toolName, arguments: args }, 180000)

      if (rpcData.error) {
        throw new Error(getRpcErrorMessage(rpcData.error) || 'Tool call error')
      }

      const result = extractToolCallResult(rpcData)
      console.log(`[MCP] Tool ${toolName} succeeded in ${Date.now() - startTime}ms`)

      return {
        toolName,
        args,
        result,
        duration: Date.now() - startTime,
        success: true,
        timestamp: Date.now(),
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[MCP] Tool ${toolName} attempt ${attempt + 1} failed: ${errorMsg}`)

      const retryableConnectionError =
        errorMsg.includes('SSE connection lost') ||
        errorMsg.includes('not connected') ||
        errorMsg.includes('Reconnecting to MCP server') ||
        errorMsg.includes('Failed to establish SSE connection') ||
        errorMsg.includes('SSE stream ended')

      if (retryableConnectionError) {
        resetConnection(runtime, pendingRequests, errorMsg, { cancelReader: true, rejectPending: true })
        if (attempt < maxRetries) {
          continue
        }
      }

      return {
        toolName,
        args,
        result: null,
        duration: Date.now() - startTime,
        success: false,
        error: errorMsg,
        timestamp: Date.now(),
      }
    }
  }

  return {
    toolName,
    args,
    result: null,
    duration: Date.now() - startTime,
    success: false,
    error: 'Exhausted all retry attempts',
    timestamp: Date.now(),
  }
}

export async function callToolsParallel(
  calls: McpParallelToolCall[],
  config?: McpServerConfig
): Promise<McpParallelToolCallResult> {
  const c = config || runtime.cachedConfig
  if (!c) throw new Error('No MCP config available')

  const startTime = Date.now()

  if (calls.length === 0) {
    return {
      calls: [],
      success: true,
      duration: 0,
      timestamp: Date.now(),
    }
  }

  const dedupedCalls: McpParallelToolCall[] = []
  const seen = new Set<string>()

  for (const call of calls) {
    const dedupeKey = `${call.toolName}:${stableSerialize(call.args)}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    dedupedCalls.push(call)
  }

  if (dedupedCalls.length < calls.length) {
    console.log(`[MCP] Parallel batch: ${calls.length} requested, ${dedupedCalls.length} unique`)
  }

  if (dedupedCalls.length === 0) {
    return {
      calls: [],
      success: true,
      duration: Date.now() - startTime,
      timestamp: Date.now(),
    }
  }

  if (!runtime.sseReader || !runtime.sseMessageEndpoint) {
    await connectToMcp(c)
  }

  const results = await Promise.all(
    dedupedCalls.map((call) => callTool(call.toolName, call.args, c))
  )

  const failedCount = results.filter((result) => !result.success).length

  console.log(
    `[MCP] Parallel batch complete: ${results.length - failedCount} ok, ${failedCount} failed, ${Date.now() - startTime}ms`
  )

  return {
    calls: results,
    success: failedCount === 0,
    duration: Date.now() - startTime,
    error: failedCount > 0 ? `${failedCount} of ${results.length} tool calls failed` : undefined,
    timestamp: Date.now(),
  }
}

export async function checkAndAutoConnect() {
  if (runtime.connectionStatus.connected && runtime.cachedTools.length > 0 && runtime.sseReader) {
    return runtime.connectionStatus
  }

  const serverUrl = process.env.MCP_SERVER_URL
  const authHeader = process.env.AUTH_HEADER

  if (serverUrl && authHeader) {
    console.log(`[MCP] Auto-connecting to ${serverUrl}...`)
    return await connectToMcp({ serverUrl, authHeader })
  }

  return runtime.connectionStatus
}

export const getConnectionStatus = () => runtime.connectionStatus
export const getCachedTools = () => runtime.cachedTools
export const getCachedConfig = () => runtime.cachedConfig
