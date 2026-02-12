import type { McpToolSchema, McpConnectionStatus, McpToolCallResult, McpServerConfig } from './types'

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
let sseBuffer = ''
const sseDecoder = new TextDecoder()

// Pending request callbacks: requestId -> { resolve, reject }
const pendingRequests = new Map<string, {
  resolve: (value: any) => void
  reject: (reason: any) => void
}>()

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
    const parsed = JSON.parse(dataStr)

    // Route response to the pending request by ID
    if (parsed.id && pendingRequests.has(parsed.id)) {
      console.log(`[MCP] Received SSE response for request ${parsed.id}`)
      const { resolve, reject } = pendingRequests.get(parsed.id)!
      pendingRequests.delete(parsed.id)

      if (parsed.error) {
        console.error(`[MCP] Server returned error for ${parsed.id}:`, parsed.error)
        reject(new Error(parsed.error.message || 'JSON-RPC error'))
      } else {
        resolve(parsed)
      }
    } else if (parsed.id) {
      console.log(`[MCP] Received SSE response for unknown request ${parsed.id} (pending: ${Array.from(pendingRequests.keys()).join(', ')})`)
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
async function startSSEReader() {
  if (!sseReader) return

  try {
    while (true) {
      const { done, value } = await sseReader.read()
      if (done) {
        console.log('[MCP] SSE stream ended')
        break
      }

      sseBuffer += sseDecoder.decode(value, { stream: true })
      const lines = sseBuffer.split('\n')
      sseBuffer = lines.pop() || ''

      for (const line of lines) {
        processSSELine(line)
      }
    }
  } catch (err) {
    console.error('[MCP] SSE reader error:', err)
  } finally {
    // Connection lost — mark as disconnected
    sseReader = null
    sseMessageEndpoint = null
    connectionStatus = { ...connectionStatus, connected: false, error: 'SSE connection lost' }

    // Reject all pending requests
    for (const [id, { reject }] of pendingRequests) {
      reject(new Error('SSE connection lost'))
      pendingRequests.delete(id)
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
  sseBuffer = buffer // Carry over any remaining buffer
  sseMessageEndpoint = fullEndpoint

  // Start background reader (don't await — it runs forever)
  startSSEReader()

  return fullEndpoint
}

/**
 * Send a JSON-RPC request via the message endpoint and wait for the response
 * to arrive on the SSE stream.
 */
async function mcpRequest(method: string, params: any = {}, timeoutMs = 30000): Promise<any> {
  if (!cachedConfig) throw new Error('No MCP config available')
  if (!sseMessageEndpoint) throw new Error('No SSE message endpoint — not connected')

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const headers = getHeaders(cachedConfig)

  // Create a promise that will be resolved when the SSE stream delivers the response
  const responsePromise = new Promise<any>((resolve, reject) => {
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

  // Wait for the response from the SSE stream (with timeout)
  const result = await Promise.race([
    responsePromise,
    new Promise((_, reject) =>
      setTimeout(() => {
        pendingRequests.delete(requestId)
        reject(new Error(`MCP request timeout (${timeoutMs / 1000}s) for ${method}`))
      }, timeoutMs)
    ),
  ])

  return result
}

export async function connectToMcp(config: McpServerConfig): Promise<McpConnectionStatus> {
  if (!config.serverUrl) {
    return (connectionStatus = { connected: false, serverUrl: '', toolCount: 0, error: 'No server URL provided.' })
  }

  cachedConfig = config

  // Close any existing SSE connection
  if (sseReader) {
    try { sseReader.cancel() } catch { }
    sseReader = null
    sseMessageEndpoint = null
  }

  try {
    // Step 1: Open persistent SSE connection
    await openSSEConnection(config.serverUrl, config)

    // Step 2: Discover tools via the SSE channel
    const toolsResponse = await mcpRequest('tools/list', {}, 15000)
    const tools: McpToolSchema[] = (toolsResponse.result?.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))

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
    return (connectionStatus = { connected: false, serverUrl: config.serverUrl, toolCount: 0, error: errorMessage })
  }
}

export async function discoverTools(config?: McpServerConfig): Promise<McpToolSchema[]> {
  const c = config || cachedConfig
  if (!c) throw new Error('No MCP config available')

  // If we have an active SSE connection, use it
  if (sseMessageEndpoint && sseReader) {
    const toolsResponse = await mcpRequest('tools/list', {}, 15000)
    const tools: McpToolSchema[] = (toolsResponse.result?.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
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
      console.log(`[MCP] Calling tool: ${toolName} (attempt ${attempt + 1}/${maxRetries + 1})`)
      const rpcData = await mcpRequest('tools/call', { name: toolName, arguments: args }, 45000)

      if (rpcData.error) {
        throw new Error(rpcData.error.message || 'Tool call error')
      }

      const result = rpcData.result?.content || rpcData.result || rpcData
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

      // If SSE connection was lost, retry with a new connection
      if (errorMsg.includes('SSE connection lost') || errorMsg.includes('not connected')) {
        sseReader = null
        sseMessageEndpoint = null
        if (attempt < maxRetries) {
          continue // Retry with reconnection
        }
      }

      // Final attempt failed or non-retryable error
      if (attempt >= maxRetries) {
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
