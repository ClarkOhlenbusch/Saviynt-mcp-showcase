import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { streamText, convertToModelMessages, stepCountIs } from 'ai'
import { SYSTEM_PROMPT } from '@/lib/agent/prompts'
import { checkAndAutoConnect, getCachedConfig, getCachedTools } from '@/lib/mcp/client'
import { getDefaultGatewayConfig } from '@/lib/mcp/tool-gateway'
import { GEMINI_FLASH_3_PREVIEW_MODEL, type GeminiUsageTotals } from '@/lib/gemini-usage'
import {
  addUsageTotals,
  buildContextMessages,
  isInvalidApiKeyError,
  isUsageLimitError,
  normalizePendingRequestsSnapshot,
  normalizeUsageTotals,
} from './chat-context'
import { buildSystemPrompt } from './chat-prompt'
import { isRecord, parsePositiveInt } from './chat-shared'
import { buildAiTools } from './chat-tools'

export const maxDuration = 300
const MAX_TOOL_STEPS = 12
const MAX_OUTPUT_TOKENS = 4096
const MAX_PARALLEL_CALLS = 6
const MAX_PENDING_SNAPSHOT_ITEMS = 12
const MAX_CONTEXT_MESSAGES = parsePositiveInt(process.env.CHAT_CONTEXT_MAX_MESSAGES, 14)
const MAX_CONTEXT_BYTES = parsePositiveInt(process.env.CHAT_CONTEXT_MAX_BYTES, 120_000)
const CONTEXT_FULL_FIDELITY_MESSAGES = parsePositiveInt(process.env.CHAT_CONTEXT_FULL_FIDELITY_MESSAGES, 6)
const MAX_HISTORICAL_ASSISTANT_CHARS = parsePositiveInt(process.env.CHAT_CONTEXT_HISTORICAL_ASSISTANT_CHARS, 1_200)

export async function POST(req: Request) {
  const body: unknown = await req.json()
  const parsedBody = isRecord(body) ? body : {}
  const messages = parsedBody.messages
  const apiKey = typeof parsedBody.apiKey === 'string' ? parsedBody.apiKey : ''
  const selectedRequest = isRecord(parsedBody.selectedRequest) ? parsedBody.selectedRequest : null
  const redactionEnabled = parsedBody.redactionEnabled !== false
  const destructiveActionsEnabled = parsedBody.destructiveActionsEnabled === true
  const pendingRequestsSnapshot = normalizePendingRequestsSnapshot(
    parsedBody.pendingRequestsSnapshot,
    MAX_PENDING_SNAPSHOT_ITEMS
  )
  const pendingRequestsSnapshotUpdatedAt = typeof parsedBody.pendingRequestsSnapshotUpdatedAt === 'number'
    ? Math.max(0, Math.floor(parsedBody.pendingRequestsSnapshotUpdatedAt))
    : 0

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Gemini API key is required (BYOK)' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  await checkAndAutoConnect()

  const mcpTools = getCachedTools()
  const mcpConfig = getCachedConfig()
  const gatewayConfig = {
    ...getDefaultGatewayConfig(),
    redactionEnabled,
    destructiveActionsEnabled,
  }
  const systemPrompt = buildSystemPrompt({
    basePrompt: SYSTEM_PROMPT,
    selectedRequest,
    pendingRequestsSnapshot,
    pendingRequestsSnapshotUpdatedAt,
    mcpToolCount: mcpTools.length,
    destructiveActionsEnabled,
  })
  const aiTools = buildAiTools({
    mcpTools,
    mcpConfig,
    gatewayConfig,
    maxParallelCalls: MAX_PARALLEL_CALLS,
  })

  const modelProvider = createGoogleGenerativeAI({
    apiKey,
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
      messages: await convertToModelMessages(
        buildContextMessages(messages, {
          maxMessages: MAX_CONTEXT_MESSAGES,
          maxBytes: MAX_CONTEXT_BYTES,
          fullFidelityMessages: CONTEXT_FULL_FIDELITY_MESSAGES,
          maxHistoricalAssistantChars: MAX_HISTORICAL_ASSISTANT_CHARS,
        })
      ),
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
    const usageLimit = isUsageLimitError(message)
    const invalidApiKey = isInvalidApiKeyError(message)

    return new Response(
      JSON.stringify({
        error: invalidApiKey
          ? 'Gemini API key is invalid. Update it in Add API Key.'
          : usageLimit
          ? 'Google API usage limit reached. Open FAQ for quota steps and key rotation guidance.'
          : message,
      }),
      {
        status: invalidApiKey ? 401 : usageLimit ? 429 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
