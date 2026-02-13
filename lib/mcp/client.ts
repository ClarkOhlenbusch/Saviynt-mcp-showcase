import type {
  McpToolSchema,
  McpConnectionStatus,
  McpToolCallResult,
  McpServerConfig,
  McpParallelToolCall,
  McpParallelToolCallResult,
} from './types'

/**
 * MCP Client that connects to a Saviynt MCP server via SSE (Server-Sent Events).
 * 
 * The MCP SSE protocol works as follows:
 * 1. Client opens a persistent SSE connection to /sse
 * 2. Server sends a message endpoint URL via the SSE stream
 * 3. Client sends JSON-RPC requests to that message endpoint
 * 4. Server sends JSON-RPC responses back on the SAME SSE stream
 * 
 * The SSE connection MUST stay open for the duration of the session.
 */

// In-memory cache
let cachedTools: McpToolSchema[] = []
let cachedConfig: McpServerConfig | null = null
let connectionStatus: McpConnectionStatus = {
  connected: false,
  serverUrl: '',
  toolCount: 0,
}

// Persistent SSE connection state
let sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null
let sseMessageEndpoint: string | null = null
let connectInFlight: Promise<McpConnectionStatus> | null = null

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void
  reject: (reason: unknown) => void
}

// Pending request callbacks: requestId -> { resolve, reject }
const pendingRequests = new Map<string, PendingRequest>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRpcId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function getRpcErrorMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (!isRecord(value)) return null

  const message = value.message
  return typeof message === 'string' && message.trim() ? message : null
}

function toMcpToolSchema(value: unknown): McpToolSchema | null {
  if (!isRecord(value)) return null
  if (typeof value.name !== 'string' || !value.name) return null

  return {
    name: value.name,
    description: typeof value.description === 'string' ? value.description : undefined,
    inputSchema: isRecord(value.inputSchema) ? value.inputSchema : undefined,
  }
}

function extractTools(rpcResponse: Record<string, unknown>): McpToolSchema[] {
  const result = isRecord(rpcResponse.result) ? rpcResponse.result : null
  const tools = Array.isArray(result?.tools) ? result.tools : []
  return tools
    .map((tool) => toMcpToolSchema(tool))
    .filter((tool): tool is McpToolSchema => tool !== null)
}

function extractToolCallResult(rpcResponse: Record<string, unknown>): unknown {
  const result = rpcResponse.result
  if (isRecord(result) && 'content' in result) {
    return result.content ?? result
  }
  return result ?? rpcResponse
}

function rejectPendingRequests(reason: string) {
  for (const [id, { reject }] of pendingRequests) {
    reject(new Error(reason))
    pendingRequests.delete(id)
  }
}

function resetConnection(
  reason: string,
  options: {
    cancelReader?: boolean
    rejectPending?: boolean
  } = {}
) {
  const { cancelReader = false, rejectPending = false } = options
  const readerToCancel = sseReader

  sseReader = null
  sseMessageEndpoint = null
  connectionStatus = { ...connectionStatus, connected: false, error: reason }

  if (rejectPending) {
    rejectPendingRequests(reason)
  }

  if (cancelReader && readerToCancel) {
    try {
      readerToCancel.cancel()
    } catch {
      // Ignore reader cancellation failures during reconnect/reset
    }
  }
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`)

  return `{${entries.join(',')}}`
}

function argsFingerprint(args: Record<string, unknown>): string {
  const serialized = stableSerialize(args)
  let hash = 0
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash * 31 + serialized.charCodeAt(i)) | 0
  }

  const keys = Object.keys(args).sort()
  const keyLabel = keys.length > 0 ? keys.join(',') : 'no-args'
  return `${keyLabel}#${Math.abs(hash)}`
}

function estimatePayloadBytes(value: unknown): number {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    return new TextEncoder().encode(serialized).length
  } catch {
    return 0
  }
}

function getHeaders(config: McpServerConfig): Record<string, string> {
  let auth = config.authHeader
  if (auth && !auth.includes(' ')) {
    if (!auth.startsWith('Bearer')) {
      auth = `Bearer ${auth}`
    } else {
      auth = auth.replace('Bearer', 'Bearer ')
    }
  }
  return {
    'Content-Type': 'application/json',
    ...(auth ? { Authorization: auth } : {}),
  }
}

/**
 * Process incoming SSE data and route responses to pending requests.
 */
function processSSELine(line: string) {
  if (!line.startsWith('data: ')) return

  const dataStr = line.slice(6).trim()
  if (!dataStr) return

  try {
    const parsed: unknown = JSON.parse(dataStr)
    if (!isRecord(parsed)) return

    const parsedId = getRpcId(parsed.id)
    if (!parsedId) return

    // Route response to the pending request by ID
    if (pendingRequests.has(parsedId)) {
      console.log(`[MCP] Received SSE response for request ${parsedId}`)
      const pendingRequest = pendingRequests.get(parsedId)
      if (!pendingRequest) return

      pendingRequests.delete(parsedId)

      if (parsed.error) {
        console.error(`[MCP] Server returned error for ${parsedId}:`, parsed.error)
        pendingRequest.reject(new Error(getRpcErrorMessage(parsed.error) || 'JSON-RPC error'))
      } else {
        pendingRequest.resolve(parsed)
      }
    } else {
      console.log(`[MCP] Received SSE response for unknown request ${parsedId} (pending: ${Array.from(pendingRequests.keys()).join(', ')})`)
    }
  } catch {
    // Not JSON — could be a message endpoint or other SSE data
    console.log(`[MCP] SSE non-JSON data: ${dataStr.substring(0, 100)}`)
  }
}

/**
 * Start the persistent SSE reader loop. This runs in the background
 * and routes all incoming messages to pending requests.
 */
async function startSSEReader(reader: ReadableStreamDefaultReader<Uint8Array>, initialBuffer = '') {
  const decoder = new TextDecoder()
  let buffer = initialBuffer

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        console.log('[MCP] SSE stream ended')
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        processSSELine(line)
      }
    }
  } catch (err) {
    console.error('[MCP] SSE reader error:', err)
  } finally {
    // Ignore stale readers that were replaced by reconnect.
    const isStaleReader = sseReader !== reader
    if (!isStaleReader) {
      // Active reader ended; mark disconnected and reject in-flight requests.
      resetConnection('SSE connection lost', { rejectPending: true })
    }
  }
}

/**
 * Open a persistent SSE connection to the MCP server.
 * Returns the message endpoint URL.
 */
async function openSSEConnection(serverUrl: string, config: McpServerConfig): Promise<string> {
  const sseUrl = serverUrl.endsWith('/sse') ? serverUrl : `${serverUrl}/sse`
  const headers = getHeaders(config)

  console.log(`[MCP] Opening SSE connection to ${sseUrl}...`)
  const response = await fetch(sseUrl, { headers })

  if (!response.ok) {
    throw new Error(`SSE connection failed: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('ReadableStream not supported')
  }

  // Read until we get the message endpoint
  const decoder = new TextDecoder()
  let buffer = ''
  let messageEndpoint = ''

  // Read initial SSE data to get the message endpoint
  const startTime = Date.now()
  while (!messageEndpoint && Date.now() - startTime < 10000) {
    const { done, value } = await reader.read()
    if (done) throw new Error('SSE stream ended before receiving message endpoint')

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim()
        // The first data message is the message endpoint URL
        if (dataStr.startsWith('/') || dataStr.startsWith('http')) {
          messageEndpoint = dataStr
        }
      }
    }
  }

  if (!messageEndpoint) {
    reader.cancel()
    throw new Error('SSE message endpoint timeout')
  }

  const baseUrl = new URL(sseUrl)
  const fullEndpoint = messageEndpoint.startsWith('http')
    ? messageEndpoint
    : `${baseUrl.origin}${messageEndpoint}`

  console.log(`[MCP] Got message endpoint: ${fullEndpoint}`)

  // Store the reader and start the background reader loop
  sseReader = reader
  sseMessageEndpoint = fullEndpoint

  // Start background reader (don't await — it runs forever)
  void startSSEReader(reader, buffer)

  return fullEndpoint
}

/**
 * Send a JSON-RPC request via the message endpoint and wait for the response
 * to arrive on the SSE stream.
 */
async function mcpRequest(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30000
): Promise<Record<string, unknown>> {
  if (!cachedConfig) throw new Error('No MCP config available')
  if (!sseMessageEndpoint) throw new Error('No SSE message endpoint — not connected')

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const headers = getHeaders(cachedConfig)

  // Create a promise that will be resolved when the SSE stream delivers the response
  const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject })
  })

  // Send the JSON-RPC request to the message endpoint
  const response = await fetch(sseMessageEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: requestId,
    }),
  })

  if (!response.ok) {
    pendingRequests.delete(requestId)
    throw new Error(`Request to message endpoint failed: ${response.status}`)
  }

  // Wait for the response from the SSE stream (with timeout).
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error(`MCP request timeout (${timeoutMs / 1000}s) for ${method}`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([responsePromise, timeoutPromise])
  } finally {
    if (timeoutHandle != null) {
      clearTimeout(timeoutHandle)
    }
  }
}

async function connectToMcpInternal(config: McpServerConfig): Promise<McpConnectionStatus> {
  if (!config.serverUrl) {
    return (connectionStatus = { connected: false, serverUrl: '', toolCount: 0, error: 'No server URL provided.' })
  }

  cachedConfig = config

  // Close any existing SSE connection.
  if (sseReader || sseMessageEndpoint) {
    resetConnection('Reconnecting to MCP server', { cancelReader: true, rejectPending: true })
  }

  try {
    // Step 1: Open persistent SSE connection
    await openSSEConnection(config.serverUrl, config)

    // Step 2: Discover tools via the SSE channel
    const toolsResponse = await mcpRequest('tools/list', {}, 15000)
    const tools = extractTools(toolsResponse)

    cachedTools = tools
    connectionStatus = {
      connected: true,
      serverUrl: config.serverUrl,
      toolCount: tools.length,
      lastConnected: Date.now(),
    }

    console.log(`[MCP] Connected! Discovered ${tools.length} tools.`)
    return connectionStatus
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown connection error'
    console.error('[MCP] Connection failed:', errorMessage)
    resetConnection(errorMessage, { cancelReader: true, rejectPending: true })
    return (connectionStatus = { connected: false, serverUrl: config.serverUrl, toolCount: 0, error: errorMessage })
  }
}

export async function connectToMcp(config: McpServerConfig): Promise<McpConnectionStatus> {
  if (connectInFlight) {
    console.log('[MCP] Awaiting in-flight connection attempt...')
    return connectInFlight
  }

  connectInFlight = connectToMcpInternal(config)
    .finally(() => {
      connectInFlight = null
    })

  return connectInFlight
}

export async function discoverTools(config?: McpServerConfig): Promise<McpToolSchema[]> {
  const c = config || cachedConfig
  if (!c) throw new Error('No MCP config available')

  // If we have an active SSE connection, use it
  if (sseMessageEndpoint && sseReader) {
    const toolsResponse = await mcpRequest('tools/list', {}, 15000)
    const tools = extractTools(toolsResponse)
    cachedTools = tools
    return tools
  }

  // Otherwise, reconnect
  await connectToMcp(c)
  return cachedTools
}

export async function callTool(toolName: string, args: Record<string, unknown>, config?: McpServerConfig): Promise<McpToolCallResult> {
  const c = config || cachedConfig
  if (!c) throw new Error('No MCP config available')

  const startTime = Date.now()
  const maxRetries = 2

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Ensure we have an active SSE connection
    if (!sseReader || !sseMessageEndpoint) {
      if (attempt === 0) {
        console.log(`[MCP] No active SSE connection for tool call, connecting...`)
      } else {
        console.log(`[MCP] SSE connection dropped, reconnecting (attempt ${attempt + 1}/${maxRetries + 1})...`)
      }
      await connectToMcp(c)
      if (!sseReader || !sseMessageEndpoint) {
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
      const requestBytes = estimatePayloadBytes(args)
      console.log(
        `[MCP] Calling tool: ${toolName} (attempt ${attempt + 1}/${maxRetries + 1}, args=${argsFingerprint(args)}, requestBytes=${requestBytes})`
      )
      const rpcData = await mcpRequest('tools/call', { name: toolName, arguments: args }, 180000)

      if (rpcData.error) {
        throw new Error(getRpcErrorMessage(rpcData.error) || 'Tool call error')
      }

      const result = extractToolCallResult(rpcData)
      const responseBytes = estimatePayloadBytes(result)
      console.log(
        `[MCP] Tool ${toolName} succeeded in ${Date.now() - startTime}ms (args=${argsFingerprint(args)}, responseBytes=${responseBytes})`
      )

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

      // Only retry on connection errors — timeouts mean the server is slow, not broken
      if (errorMsg.includes('SSE connection lost') || errorMsg.includes('not connected')) {
        resetConnection(errorMsg, { cancelReader: true, rejectPending: true })
        if (attempt < maxRetries) {
          continue // Retry with reconnection
        }
      }

      // Non-retryable error (timeout, server error, etc.) or exhausted retries — fail immediately
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

  // Should not reach here, but just in case
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
  const c = config || cachedConfig
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
      console.log(`[MCP] Skipping duplicate parallel tool call: ${call.toolName} (args=${argsFingerprint(call.args)})`)
      continue
    }
    seen.add(dedupeKey)
    dedupedCalls.push(call)
  }

  console.log(
    `[MCP] Parallel batch requested=${calls.length}, unique=${dedupedCalls.length}`
  )

  if (dedupedCalls.length === 0) {
    return {
      calls: [],
      success: true,
      duration: Date.now() - startTime,
      timestamp: Date.now(),
    }
  }

  // Ensure a single shared connection before firing parallel RPC calls.
  if (!sseReader || !sseMessageEndpoint) {
    await connectToMcp(c)
  }

  const results = await Promise.all(
    dedupedCalls.map((call) => callTool(call.toolName, call.args, c))
  )

  const failedCount = results.filter((result) => !result.success).length
  const totalRequestBytes = dedupedCalls.reduce((total, call) => total + estimatePayloadBytes(call.args), 0)
  const totalResponseBytes = results
    .filter((result) => result.success)
    .reduce((total, result) => total + estimatePayloadBytes(result.result), 0)

  console.log(
    `[MCP] Parallel batch complete: success=${results.length - failedCount}, failed=${failedCount}, requestBytes=${totalRequestBytes}, responseBytes=${totalResponseBytes}, duration=${Date.now() - startTime}ms`
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
  // If already connected and has tools, skip
  if (connectionStatus.connected && cachedTools.length > 0 && sseReader) {
    return connectionStatus
  }

  const serverUrl = process.env.MCP_SERVER_URL
  const authHeader = process.env.AUTH_HEADER

  if (serverUrl && authHeader) {
    console.log(`[MCP] Auto-connecting to ${serverUrl}...`)
    return await connectToMcp({ serverUrl, authHeader })
  }

  return connectionStatus
}

export const getConnectionStatus = () => connectionStatus
export const getCachedTools = () => cachedTools
export const getCachedConfig = () => cachedConfig
