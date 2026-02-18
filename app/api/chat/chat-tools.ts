import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { callTool } from '@/lib/mcp/client'
import { compactMcpPayload, describePayloadShape } from '@/lib/mcp/payload-optimizer'
import { recordMcpPayloadProfile } from '@/lib/mcp/payload-profiler'
import { redactDeep, truncatePreview } from '@/lib/redaction'
import { validateToolCall, type ToolGatewayConfig } from '@/lib/mcp/tool-gateway'
import type { McpServerConfig, McpToolCallResult, McpToolSchema } from '@/lib/mcp/types'
import { estimatePayloadBytes, isRecord, stableSerialize } from './chat-shared'

type ParallelCall = {
  toolName: string
  args: Record<string, unknown>
}

type BuildAiToolsParams = {
  mcpTools: McpToolSchema[]
  mcpConfig: McpServerConfig | null
  gatewayConfig: ToolGatewayConfig
  maxParallelCalls: number
  saviyntCredentials?: { username: string; password: string }
}

const toolSchemaCache = new Map<string, z.ZodObject<Record<string, z.ZodTypeAny>>>()

export function buildAiTools({
  mcpTools,
  mcpConfig,
  gatewayConfig,
  maxParallelCalls,
  saviyntCredentials,
}: BuildAiToolsParams): ToolSet {
  const mcpToolsByName = new Map(mcpTools.map((toolSchema) => [toolSchema.name, toolSchema] as const))
  const aiTools: ToolSet = {}

  for (const mcpTool of mcpTools) {
    const validation = validateToolCall(mcpTool.name, {}, mcpTool, gatewayConfig)
    if (!validation.valid) continue

    const inputSchema = getToolInputSchema(mcpTool.name, mcpTool.inputSchema)

    aiTools[mcpTool.name] = tool({
      description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
      inputSchema,
      execute: async (args: unknown) => {
        const toolArgs = isRecord(args) ? args : {}
        const result = await callTool(mcpTool.name, toolArgs, mcpConfig || undefined, saviyntCredentials)
        if (!result.success) {
          return { error: result.error, toolName: mcpTool.name }
        }

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
      description: `Execute up to ${maxParallelCalls} independent MCP tool calls in parallel and return when all are complete.`,
      inputSchema: z.object({
        calls: z.array(
          z.object({
            toolName: z.string().describe('Exact MCP tool name to call'),
            args: z.record(z.unknown()).default({}).describe('Arguments for that MCP tool call'),
          })
        ).min(1).max(maxParallelCalls),
      }),
      execute: async function* ({
        calls,
      }: {
        calls: ParallelCall[]
      }) {
        const validatedCalls: ParallelCall[] = []

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
          result: McpToolCallResult
        }>>()

        for (let index = 0; index < uniqueCalls.length; index++) {
          const call = uniqueCalls[index]
          const startedAt = Date.now()
          const task = callTool(call.toolName, call.args, mcpConfig || undefined, saviyntCredentials)
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

          yield buildSnapshot(false)
        }

        return buildSnapshot(true)
      },
    })
  }

  return aiTools
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

function dedupeParallelCalls(calls: ParallelCall[]): {
  calls: ParallelCall[]
  originalCount: number
} {
  const seen = new Set<string>()
  const deduped: ParallelCall[] = []

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

    shape[key] = fieldSchema.nullable()
  }

  return z.object(shape)
}
