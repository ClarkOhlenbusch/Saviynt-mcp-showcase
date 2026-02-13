import { streamText, convertToModelMessages, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { SYSTEM_PROMPT } from '@/lib/agent/prompts'
import { callTool, getCachedTools, getCachedConfig, checkAndAutoConnect } from '@/lib/mcp/client'
import { getDefaultGatewayConfig, validateToolCall } from '@/lib/mcp/tool-gateway'
import { redactDeep } from '@/lib/redaction'

export const maxDuration = 300
const MAX_TOOL_STEPS = 12
const MAX_OUTPUT_TOKENS = 4096
const MAX_PARALLEL_CALLS = 6

export async function POST(req: Request) {
  const { messages, apiKey } = await req.json()

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Gemini API key is required (BYOK)' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const effectiveApiKey = apiKey

  // Ensure MCP is connected before gathering tools
  await checkAndAutoConnect()

  const mcpTools = getCachedTools()
  const mcpConfig = getCachedConfig()
  const gatewayConfig = getDefaultGatewayConfig()
  const mcpToolsByName = new Map(mcpTools.map((toolSchema) => [toolSchema.name, toolSchema] as const))

  // Build the system prompt
  let systemPrompt = SYSTEM_PROMPT

  // Add available tools context to system prompt
  if (mcpTools.length > 0) {
    systemPrompt += '\n\n## Available MCP Tools\n\n'
    systemPrompt += 'You have access to the following Saviynt MCP tools. Use them to gather real data:\n\n'
    for (const t of mcpTools) {
      systemPrompt += `- **${t.name}**: ${t.description || 'No description'}\n`
    }
    systemPrompt += '\nCall these tools when you need identity data. Always call tools before making assertions about users, access, or risk.'
    systemPrompt += '\nWhen multiple independent MCP lookups are needed, prefer the `mcp_parallel` tool to run calls concurrently and then reason on the combined results.'
  }

  // Dynamically build AI SDK tools from MCP tool schemas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiTools: Record<string, any> = {}

  for (const mcpTool of mcpTools) {
    const validation = validateToolCall(mcpTool.name, {}, mcpTool, gatewayConfig)
    if (!validation.valid) continue

    // Build a zod schema from the MCP tool's input schema
    const inputSchema = buildZodSchema(mcpTool.inputSchema)

    aiTools[mcpTool.name] = tool({
      description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
      inputSchema,
      execute: async (args) => {
        const result = await callTool(mcpTool.name, args as Record<string, unknown>, mcpConfig || undefined)
        if (!result.success) {
          return { error: result.error, toolName: mcpTool.name }
        }
        // Redact sensitive data before returning to LLM
        const redactedResult = redactDeep(result.result, gatewayConfig.redactionEnabled)
        return {
          toolName: mcpTool.name,
          data: redactedResult,
          duration: result.duration,
        }
      },
    })
  }

  if (mcpTools.length > 0) {
    aiTools.mcp_parallel = tool({
      description: `Execute up to ${MAX_PARALLEL_CALLS} independent MCP tool calls in parallel and return when all are complete.`,
      inputSchema: z.object({
        calls: z.array(
          z.object({
            toolName: z.string().describe('Exact MCP tool name to call'),
            args: z.record(z.unknown()).default({}).describe('Arguments for that MCP tool call'),
          })
        ).min(1).max(MAX_PARALLEL_CALLS),
      }),
      execute: async function* ({ calls }) {
        const validatedCalls: Array<{ toolName: string; args: Record<string, unknown> }> = []

        for (const call of calls) {
          const toolSchema = mcpToolsByName.get(call.toolName)
          const validation = validateToolCall(call.toolName, call.args, toolSchema, gatewayConfig)
          if (!validation.valid) {
            return { error: validation.error || `Invalid tool call: ${call.toolName}`, toolName: call.toolName }
          }

          validatedCalls.push({
            toolName: call.toolName,
            args: call.args,
          })
        }

        const deduped = dedupeParallelCalls(validatedCalls)
        const uniqueCalls = deduped.calls
        const startTime = Date.now()

        if (uniqueCalls.length === 0) {
          return {
            toolName: 'mcp_parallel',
            count: 0,
            dedupedFrom: deduped.originalCount,
            completed: 0,
            failed: 0,
            inProgress: 0,
            duration: 0,
            success: true,
            results: [],
          }
        }

        type ParallelRow = {
          toolName: string
          args: Record<string, unknown>
          status: 'running' | 'complete' | 'error'
          data?: unknown
          error?: string
          duration?: number
          requestBytes: number
          responseBytes?: number
        }

        const rows: ParallelRow[] = uniqueCalls.map((call) => ({
          toolName: call.toolName,
          args: call.args,
          status: 'running',
          requestBytes: estimatePayloadBytes(call.args),
        }))

        const buildSnapshot = () => {
          const completed = rows.filter((row) => row.status === 'complete').length
          const failed = rows.filter((row) => row.status === 'error').length
          const inProgress = rows.length - completed - failed
          return {
            toolName: 'mcp_parallel' as const,
            count: rows.length,
            dedupedFrom: deduped.originalCount,
            completed,
            failed,
            inProgress,
            duration: Date.now() - startTime,
            success: failed === 0 && inProgress === 0,
            error: failed > 0 && inProgress === 0 ? `${failed} of ${rows.length} tool calls failed` : undefined,
            results: rows.map((row) => ({ ...row })),
          }
        }

        const pending = new Map<number, Promise<{
          index: number
          result: Awaited<ReturnType<typeof callTool>>
        }>>()

        for (let index = 0; index < uniqueCalls.length; index++) {
          const call = uniqueCalls[index]
          const startedAt = Date.now()
          const task = callTool(call.toolName, call.args, mcpConfig || undefined)
            .then((result) => ({ index, result }))
            .catch((err) => ({
              index,
              result: {
                toolName: call.toolName,
                args: call.args,
                result: null,
                duration: Date.now() - startedAt,
                success: false,
                error: err instanceof Error ? err.message : 'Unknown tool error',
                timestamp: Date.now(),
              },
            }))
          pending.set(index, task)
        }

        while (pending.size > 0) {
          const settled = await Promise.race(pending.values())
          pending.delete(settled.index)

          const row = rows[settled.index]
          row.duration = settled.result.duration

          if (settled.result.success) {
            row.status = 'complete'
            row.data = redactDeep(settled.result.result, gatewayConfig.redactionEnabled)
            row.responseBytes = estimatePayloadBytes(settled.result.result)
          } else {
            row.status = 'error'
            row.error = settled.result.error || 'Unknown tool error'
            row.responseBytes = 0
          }

          // Yielding from an async generator emits a preliminary tool result chunk.
          yield buildSnapshot()
        }

        return buildSnapshot()
      },
    })
  }

  // Initialize model provider
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
  const modelProvider = createGoogleGenerativeAI({
    apiKey: effectiveApiKey,
  })

  try {
    const result = streamText({
      model: modelProvider('gemini-3-flash-preview'),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: aiTools,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      providerOptions: {
        google: {
          thinkingConfig: { includeThoughts: true, thinkingLevel: 'low' },
        },
      },
    })

    return result.toUIMessageStreamResponse({
      headers: {
        'Content-Encoding': 'none',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate response'
    const isUsageLimit = isUsageLimitError(message)

    return new Response(
      JSON.stringify({
        error: isUsageLimit
          ? 'Google API usage limit reached. Open FAQ for quota steps and key rotation guidance.'
          : message,
      }),
      {
        status: isUsageLimit ? 429 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

function isUsageLimitError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('quota') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('resource_exhausted') ||
    normalized.includes('limit exceeded') ||
    normalized.includes('429')
  )
}

function estimatePayloadBytes(value: unknown): number {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    return new TextEncoder().encode(serialized).length
  } catch {
    return 0
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

function dedupeParallelCalls(calls: Array<{ toolName: string; args: Record<string, unknown> }>): {
  calls: Array<{ toolName: string; args: Record<string, unknown> }>
  originalCount: number
} {
  const seen = new Set<string>()
  const deduped: Array<{ toolName: string; args: Record<string, unknown> }> = []

  for (const call of calls) {
    const key = `${call.toolName}:${stableSerialize(call.args)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(call)
  }

  return {
    calls: deduped,
    originalCount: calls.length,
  }
}

// Convert MCP JSON schema to zod schema
function buildZodSchema(inputSchema?: Record<string, unknown>): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (!inputSchema || !inputSchema.properties) {
    return z.object({})
  }

  const properties = inputSchema.properties as Record<string, Record<string, unknown>>
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [key, prop] of Object.entries(properties)) {
    let fieldSchema: z.ZodTypeAny

    switch (prop.type) {
      case 'string':
        fieldSchema = z.string().describe((prop.description as string) || key)
        break
      case 'number':
      case 'integer':
        fieldSchema = z.number().describe((prop.description as string) || key)
        break
      case 'boolean':
        fieldSchema = z.boolean().describe((prop.description as string) || key)
        break
      default:
        fieldSchema = z.string().describe((prop.description as string) || key)
    }

    // Make all fields nullable for OpenAI compatibility
    shape[key] = fieldSchema.nullable()
  }

  return z.object(shape)
}
