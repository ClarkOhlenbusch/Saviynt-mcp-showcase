import type { McpServerConfig } from './types'
import type { McpClientRuntime, PendingRequestMap } from './client-runtime'
import { getHeaders, getRpcErrorMessage, getRpcId, isRecord } from './client-helpers'

function rejectPendingRequests(pendingRequests: PendingRequestMap, reason: string) {
  for (const [id, { reject }] of pendingRequests) {
    reject(new Error(reason))
    pendingRequests.delete(id)
  }
}

export function resetConnection(
  runtime: McpClientRuntime,
  pendingRequests: PendingRequestMap,
  reason: string,
  options: {
    cancelReader?: boolean
    rejectPending?: boolean
  } = {}
) {
  const { cancelReader = false, rejectPending = false } = options
  const readerToCancel = runtime.sseReader
  const controllerToAbort = runtime.sseAbortController

  runtime.sseReader = null
  runtime.sseMessageEndpoint = null
  runtime.sseAbortController = null
  runtime.connectionStatus = { ...runtime.connectionStatus, connected: false, error: reason }

  if (rejectPending) {
    rejectPendingRequests(pendingRequests, reason)
  }

  if (cancelReader && readerToCancel) {
    try {
      readerToCancel.cancel()
    } catch {
      // Ignore reader cancellation failures during reconnect/reset
    }
  }

  // Abort the underlying fetch to release the TCP socket and any buffered data
  if (controllerToAbort) {
    try {
      controllerToAbort.abort()
    } catch {
      // Ignore abort failures
    }
  }
}

function processSSELine(runtime: McpClientRuntime, pendingRequests: PendingRequestMap, line: string) {
  if (!line.startsWith('data: ')) return

  const dataStr = line.slice(6).trim()
  if (!dataStr) return

  try {
    const parsed: unknown = JSON.parse(dataStr)
    if (!isRecord(parsed)) return

    const parsedId = getRpcId(parsed.id)
    if (!parsedId) return

    if (pendingRequests.has(parsedId)) {
      const pendingRequest = pendingRequests.get(parsedId)
      if (!pendingRequest) return

      pendingRequests.delete(parsedId)

      if (parsed.error) {
        console.error(`[MCP] Server returned error for ${parsedId}:`, parsed.error)
        pendingRequest.reject(new Error(getRpcErrorMessage(parsed.error) || 'JSON-RPC error'))
      } else {
        pendingRequest.resolve(parsed)
      }
    }
  } catch {
    // Not JSON – ignore (message endpoint or heartbeat data).
  }
}

async function startSSEReader(
  runtime: McpClientRuntime,
  pendingRequests: PendingRequestMap,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialBuffer = ''
) {
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
        processSSELine(runtime, pendingRequests, line)
      }
    }
  } catch (err) {
    console.error('[MCP] SSE reader error:', err)
  } finally {
    const isStaleReader = runtime.sseReader !== reader
    if (!isStaleReader) {
      resetConnection(runtime, pendingRequests, 'SSE connection lost', { rejectPending: true })
    }
  }
}

export async function openSSEConnection(
  runtime: McpClientRuntime,
  pendingRequests: PendingRequestMap,
  serverUrl: string,
  config: McpServerConfig
): Promise<string> {
  const sseUrl = serverUrl.endsWith('/sse') ? serverUrl : `${serverUrl}/sse`
  const headers = getHeaders(config)

  // Create an AbortController so the underlying fetch can be torn down on reset
  const controller = new AbortController()

  console.log(`[MCP] Opening SSE connection to ${sseUrl}...`)
  const response = await fetch(sseUrl, { headers, signal: controller.signal })

  if (!response.ok) {
    controller.abort()
    throw new Error(`SSE connection failed: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    controller.abort()
    throw new Error('ReadableStream not supported')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let messageEndpoint = ''

  const startTime = Date.now()
  while (!messageEndpoint && Date.now() - startTime < 10000) {
    const { done, value } = await reader.read()
    if (done) {
      controller.abort()
      throw new Error('SSE stream ended before receiving message endpoint')
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim()
        if (dataStr.startsWith('/') || dataStr.startsWith('http')) {
          messageEndpoint = dataStr
        }
      }
    }
  }

  if (!messageEndpoint) {
    reader.cancel()
    controller.abort()
    throw new Error('SSE message endpoint timeout')
  }

  const baseUrl = new URL(sseUrl)
  const fullEndpoint = messageEndpoint.startsWith('http')
    ? messageEndpoint
    : `${baseUrl.origin}${messageEndpoint}`

  console.log(`[MCP] Got message endpoint: ${fullEndpoint}`)

  runtime.sseReader = reader
  runtime.sseMessageEndpoint = fullEndpoint
  runtime.sseAbortController = controller

  void startSSEReader(runtime, pendingRequests, reader, buffer)

  return fullEndpoint
}

export async function mcpRequest(
  runtime: McpClientRuntime,
  pendingRequests: PendingRequestMap,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30000
): Promise<Record<string, unknown>> {
  if (!runtime.cachedConfig) throw new Error('No MCP config available')
  if (!runtime.sseMessageEndpoint) throw new Error('No SSE message endpoint - not connected')

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const headers = getHeaders(runtime.cachedConfig)

  const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject })
  })

  const response = await fetch(runtime.sseMessageEndpoint, {
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
    // Drain the response body to prevent memory leaks from unconsumed fetch responses
    try { await response.text() } catch { /* ignore drain errors */ }
    throw new Error(`Request to message endpoint failed: ${response.status}`)
  }

  // Drain the response body immediately – the actual result arrives via SSE,
  // so this POST response body is empty/irrelevant but MUST be consumed to
  // free the browser's internal fetch buffer and prevent memory leaks.
  try { await response.text() } catch { /* ignore drain errors */ }

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
