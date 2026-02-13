import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { streamText, convertToModelMessages, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { SYSTEM_PROMPT } from '@/lib/agent/prompts'
import { callTool, getCachedTools, getCachedConfig, checkAndAutoConnect } from '@/lib/mcp/client'
import { getDefaultGatewayConfig, validateToolCall } from '@/lib/mcp/tool-gateway'
import { redactDeep, truncatePreview } from '@/lib/redaction'
import { GEMINI_FLASH_3_PREVIEW_MODEL, type GeminiUsageTotals } from '@/lib/gemini-usage'
import { compactMcpPayload, describePayloadShape } from '@/lib/mcp/payload-optimizer'
import { recordMcpPayloadProfile } from '@/lib/mcp/payload-profiler'

export const maxDuration = 300
const MAX_TOOL_STEPS = 12
const MAX_OUTPUT_TOKENS = 4096
const MAX_PARALLEL_CALLS = 6
const MAX_CONTEXT_MESSAGES = parsePositiveInt(process.env.CHAT_CONTEXT_MAX_MESSAGES, 14)
const MAX_CONTEXT_BYTES = parsePositiveInt(process.env.CHAT_CONTEXT_MAX_BYTES, 120_000)
const CONTEXT_FULL_FIDELITY_MESSAGES = parsePositiveInt(process.env.CHAT_CONTEXT_FULL_FIDELITY_MESSAGES, 6)
const MAX_HISTORICAL_ASSISTANT_CHARS = parsePositiveInt(process.env.CHAT_CONTEXT_HISTORICAL_ASSISTANT_CHARS, 1_200)
const toolSchemaCache = new Map<string, z.ZodObject<Record<string, z.ZodTypeAny>>>()
type ModelInputMessages = Parameters<typeof convertToModelMessages>[0]
type ModelInputMessage = ModelInputMessages[number]

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

  // Keep tool guidance concise to avoid spending prompt tokens on large tool catalogs.
  if (mcpTools.length > 0) {
    systemPrompt += '\n\n## MCP Tool Access\n'
    systemPrompt += `You currently have ${mcpTools.length} Saviynt MCP tools available through function calling.`
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
    const inputSchema = getToolInputSchema(mcpTool.name, mcpTool.inputSchema)

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
        const compacted = compactMcpPayload(redactedResult)
        recordMcpPayloadProfile({
          toolName: mcpTool.name,
          phase: 'single',
          payloadShape: describePayloadShape(redactedResult),
          payloadPreview: truncatePreview(redactedResult, 1600),
          profile: compacted.profile,
          timestamp: result.timestamp,
        })
        return {
          toolName: mcpTool.name,
          data: compacted.data,
          payloadProfile: compacted.profile,
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
          rawResponseBytes?: number
          responseBytes?: number
          payloadProfile?: unknown
        }

        const rows: ParallelRow[] = uniqueCalls.map((call) => ({
          toolName: call.toolName,
          args: call.args,
          status: 'running',
          requestBytes: estimatePayloadBytes(call.args),
        }))

        const buildSnapshot = (includeData: boolean) => {
          const completed = rows.filter((row) => row.status === 'complete').length
          const failed = rows.filter((row) => row.status === 'error').length
          const inProgress = rows.length - completed - failed

          const results = rows.map((row) => {
            const snapshot: ParallelRow = {
              toolName: row.toolName,
              args: row.args,
              status: row.status,
              error: row.error,
              duration: row.duration,
              requestBytes: row.requestBytes,
              rawResponseBytes: row.rawResponseBytes,
              responseBytes: row.responseBytes,
            }

            if (includeData) {
              snapshot.data = row.data
              snapshot.payloadProfile = row.payloadProfile
            }

            return snapshot
          })

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
            results,
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
            const redactedResult = redactDeep(settled.result.result, gatewayConfig.redactionEnabled)
            const compacted = compactMcpPayload(redactedResult)
            row.data = compacted.data
            row.rawResponseBytes = compacted.profile.rawBytes
            row.responseBytes = compacted.profile.compactedBytes
            row.payloadProfile = compacted.profile
            recordMcpPayloadProfile({
              toolName: row.toolName,
              phase: 'parallel',
              payloadShape: describePayloadShape(redactedResult),
              payloadPreview: truncatePreview(redactedResult, 1600),
              profile: compacted.profile,
              timestamp: settled.result.timestamp,
            })
          } else {
            row.status = 'error'
            row.error = settled.result.error || 'Unknown tool error'
            row.rawResponseBytes = 0
            row.responseBytes = 0
          }

          // Yielding from an async generator emits a preliminary tool result chunk.
          yield buildSnapshot(false)
        }

        return buildSnapshot(true)
      },
    })
  }

  // Initialize model provider
  const modelProvider = createGoogleGenerativeAI({
    apiKey: effectiveApiKey,
  })

  try {
    let streamedUsageTotals: GeminiUsageTotals = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    }

    const result = streamText({
      model: modelProvider(GEMINI_FLASH_3_PREVIEW_MODEL),
      system: systemPrompt,
      messages: await convertToModelMessages(buildContextMessages(messages)),
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
      messageMetadata: ({ part }) => {
        if (part.type === 'start') {
          return {
            model: GEMINI_FLASH_3_PREVIEW_MODEL,
            usage: streamedUsageTotals,
            usageUpdatedAt: Date.now(),
            usageIsFinal: false,
          }
        }

        if (part.type === 'finish-step') {
          streamedUsageTotals = addUsageTotals(
            streamedUsageTotals,
            normalizeUsageTotals(part.usage)
          )

          return {
            model: GEMINI_FLASH_3_PREVIEW_MODEL,
            usage: streamedUsageTotals,
            usageUpdatedAt: Date.now(),
            usageIsFinal: false,
          }
        }

        if (part.type === 'finish') {
          streamedUsageTotals = normalizeUsageTotals(part.totalUsage)

          return {
            model: GEMINI_FLASH_3_PREVIEW_MODEL,
            usage: streamedUsageTotals,
            usageUpdatedAt: Date.now(),
            usageIsFinal: true,
          }
        }

        return undefined
      },
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

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}... [truncated for context]`
}

function toModelInputMessage(value: unknown): ModelInputMessage | null {
  if (!isRecord(value)) return null
  if (typeof value.role !== 'string' || !Array.isArray(value.parts)) return null

  const { id: _id, ...rest } = value
  return rest as ModelInputMessage
}

function slimHistoricalAssistantMessage(message: ModelInputMessage): ModelInputMessage {
  if (message.role !== 'assistant' || !Array.isArray(message.parts)) {
    return message
  }

  const textParts = message.parts
    .filter((part): part is { type: 'text'; text: string } => isRecord(part) && part.type === 'text' && typeof part.text === 'string')
    .map((part) => ({
      ...part,
      text: truncateText(part.text, MAX_HISTORICAL_ASSISTANT_CHARS),
    }))

  if (textParts.length === 0) {
    return {
      ...message,
      parts: [{
        type: 'text',
        text: '[Prior tool output omitted to preserve context budget.]',
      }] as ModelInputMessage['parts'],
    }
  }

  return {
    ...message,
    parts: textParts as ModelInputMessage['parts'],
  }
}

function buildContextMessages(messages: unknown): ModelInputMessages {
  if (!Array.isArray(messages)) return []

  const normalized = messages
    .map((message) => toModelInputMessage(message))
    .filter((message): message is ModelInputMessage => message !== null)

  if (normalized.length === 0) return []

  const selected: ModelInputMessage[] = []
  let usedBytes = 0

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index]
    const distanceFromLatest = normalized.length - 1 - index
    const preserveFullMessage = distanceFromLatest < CONTEXT_FULL_FIDELITY_MESSAGES
    const candidate = preserveFullMessage ? message : slimHistoricalAssistantMessage(message)
    const candidateBytes = estimatePayloadBytes(candidate)

    if (selected.length === 0) {
      selected.push(candidate)
      usedBytes += candidateBytes
      continue
    }

    if (selected.length >= MAX_CONTEXT_MESSAGES) continue
    if (usedBytes + candidateBytes > MAX_CONTEXT_BYTES) continue

    selected.push(candidate)
    usedBytes += candidateBytes
  }

  return selected.reverse()
}

function normalizeUsageTotals(usage: {
  inputTokens: number | undefined
  outputTokens: number | undefined
  totalTokens: number | undefined
}): GeminiUsageTotals {
  const inputTokens = Math.max(0, usage.inputTokens ?? 0)
  const outputTokens = Math.max(0, usage.outputTokens ?? 0)
  const totalTokens = Math.max(0, usage.totalTokens ?? inputTokens + outputTokens)

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  }
}

function addUsageTotals(a: GeminiUsageTotals, b: GeminiUsageTotals): GeminiUsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
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

function getToolInputSchema(
  toolName: string,
  inputSchema?: Record<string, unknown>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const cacheKey = `${toolName}:${stableSerialize(inputSchema ?? {})}`
  const cached = toolSchemaCache.get(cacheKey)
  if (cached) return cached

  const built = buildZodSchema(inputSchema)
  toolSchemaCache.set(cacheKey, built)
  return built
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
